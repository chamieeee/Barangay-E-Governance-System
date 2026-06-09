// ============================================================
// importing stuff from firebase
// basically we can't use firebase without importing these first,
// think of it like getting supplies before starting a project
// ============================================================

// this is the main firebase thing, we need it to start everything
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

import { 
    getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, where, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

import { 
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";


// ============================================================
// firebase config / setup
// this is basically the address and password to our firebase project
// you get this from the firebase console when you create a project
// ============================================================

// don't touch these keys, they're what connects our app to the right firebase project
const firebaseConfig = {
    apiKey: "AIzaSyBZ70EKMokniSj2qDcMiHw3jSxt6qH157g",
    authDomain: "barangay-e-governance-system.firebaseapp.com",
    projectId: "barangay-e-governance-system", 
    storageBucket: "barangay-e-governance-system.firebasestorage.app",
    messagingSenderId: "98530921404",
    appId: "1:98530921404:web:e28508e919fa05d62bb9b9",
    measurementId: "G-R3E94KGYXW"
};

// actually start firebase using our config above
const app = initializeApp(firebaseConfig);

// get the database (firestore) ready so we can read and write data
const db = getFirestore(app);

// get the auth system ready so we can log users in and out
const auth = getAuth(app);

// ============================================================
// EmailJS setup - used to send automatic email notifications
// to residents when their request or report status is updated.
//
// HOW TO SET THIS UP:
//   1. Go to https://www.emailjs.com and create a free account
//   2. Add an Email Service (Gmail recommended) → copy the Service ID
//   3. Create an Email Template with these variables:
//        {{to_email}}   - recipient's email address
//        {{to_name}}    - recipient's name
//        {{subject}}    - email subject line
//        {{message}}    - the status update message body
//        {{updated_by}} - which admin processed the update
//      Copy the Template ID.
//   4. Go to Account → API Keys → copy your Public Key
//   5. Replace the three placeholder strings below with your real values.
// ============================================================
const EMAILJS_SERVICE_ID  = "YOUR_SERVICE_ID";   // e.g. "service_abc123"
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";  // e.g. "template_xyz789"
const EMAILJS_PUBLIC_KEY  = "YOUR_PUBLIC_KEY";   // e.g. "abcDEFghiJKL"

// initialize EmailJS with your public key (must run before any emailjs.send() call)
if (typeof emailjs !== "undefined") {
    emailjs.init(EMAILJS_PUBLIC_KEY);
}

// sends a status-update email to a resident if they opted in to email notifications.
// call this inside any approve / resolve / archive handler after the firestore update.
//   recipientEmail - the resident's registered email address
//   recipientName  - their full name (shown in the greeting)
//   subject        - email subject line (e.g. "Your Barangay Clearance is Ready")
//   message        - the body text describing what changed
//   updatedBy      - admin email or "System" to credit who made the change
async function sendStatusUpdateEmail(recipientEmail, recipientName, subject, message, updatedBy) {
    if (typeof emailjs === "undefined") {
        console.warn("EmailJS SDK not loaded — skipping email send.");
        return;
    }
    if (!recipientEmail || recipientEmail === "anonymous@domain.com") return;

    try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
            to_email:   recipientEmail,
            to_name:    recipientName || recipientEmail,
            subject:    subject,
            message:    message,
            updated_by: updatedBy || "Barangay Staff"
        });
        console.log(`Email notification sent to ${recipientEmail}`);
    } catch (err) {
        // log the error but don't crash the app — email is a bonus notification
        console.error("EmailJS send failed:", err);
    }
}

// these are basically shortcuts to the different "folders" in our database
// instead of typing collection(db, "document_requests") every single time,
// we save it to a variable so we can just write docRequestColl
const docRequestColl = collection(db, "document_requests");
const complaintsColl = collection(db, "complaints");
const systemNotifColl = collection(db, "system_notifications"); 
const announcementColl = collection(db, "announcements");

// this object stores the price of each document type
// we use it to auto-fill the fee whenever the user picks a document
// if the doc is free (like Certificate of Indigency), it's just 0.00
const BARANGAY_PRICING_SHEET = {
    "Barangay Clearance": 50.00,
    "Certificate of Indigency": 0.00,
    "Certificate of Residency": 75.00,
    "Barangay ID Card": 100.00,
    "Barangay Business Permit": 500.00,
    "Working Permit / Eco Clearance": 150.00,
    "Locational Clearance Permit": 300.00,
    "Construction & Excavation Permit": 750.00,
    "Flea Market / Vendor Permit": 200.00,
    "Public Sound / Event Permit": 150.00
};

// we save the logged-in user's role here (either "Admin" or "Resident")
// so we don't have to keep fetching it from the database every time we need it
// default is "Resident" just in case nothing is found
let currentCachedUserRole = "Resident";

// this array holds "unsubscribe" functions for all our real-time listeners
// basically when we use onSnapshot(), it returns a function we can call to stop listening
// we collect all of them here so we can stop them all at once when the user logs out
// if we don't stop them, they keep running even after logout which causes bugs
let activeDashboardStatsUnsubscribers = [];


/* ============================================================
   part 1 - handling login, logout, and page redirecting
   this is the first thing that runs when the page loads
   ============================================================ */

// we use these to check which page we're currently on
// !! converts the result to true/false (true = element exists on this page)
const ON_LOGIN_PAGE = !!document.getElementById("loginForm") && !document.getElementById("adminDashboardPage");
const ON_DASHBOARD_PAGE = !!document.getElementById("adminDashboardPage");

// onAuthStateChanged fires every time the user's login status changes
// it also runs once immediately when the page loads, so it's perfect for
// checking if someone is already logged in when they open the site
onAuthStateChanged(auth, async (user) => {

    // every time login state changes, we stop any old real-time listeners
    // to avoid having duplicate listeners stacking up (which would cause double updates)
    activeDashboardStatsUnsubscribers.forEach(unsub => unsub());
    activeDashboardStatsUnsubscribers = []; // clear the list after stopping them

    if (user) {
        // user is logged in!

        // if they're already logged in but somehow on the login page, send them to the dashboard
        // this handles the case where they manually type index.html in the url
        if (ON_LOGIN_PAGE) {
            window.location.href = "dashboard.html";
            return; // stop running the rest of the code below
        }

        // grab all the sidebar elements we need to update now that someone is logged in
        const logoutBtn = document.getElementById("logoutBtn");
        const userBadgeWrapper = document.getElementById("userBadgeWrapper");
        const userBadge = document.getElementById("userBadge");
        const roleBadge = document.getElementById("roleBadge");
        const sidebarMenu = document.getElementById("sidebarMenu");
        const residentLinks = document.getElementById("residentLinks");
        const adminLinks = document.getElementById("adminLinks");

        // show their username in the sidebar
        // user.email looks like "juan@gmail.com", split('@')[0] gives us just "juan"
        userBadge.innerText = user.email.split('@')[0];

        // make the username area, logout button, and sidebar menu visible
        // (they were hidden by default so anonymous users don't see them)
        userBadgeWrapper.classList.remove("hidden");
        logoutBtn.classList.remove("hidden");
        sidebarMenu.classList.remove("hidden");

        // load this user's saved profile info and fill in the profile form fields
        syncUserProfileViewDetails(user.uid, user.email);

        try {
            // fetch the user's role document from the "user_roles" collection in firestore
            // the document id is the user's uid, so we can find it directly
            const roleSnapshot = await getDoc(doc(db, "user_roles", user.uid));
            let finalRole = "Resident"; // assume resident first, override if we find something
            
            if (roleSnapshot.exists()) {
                // .data() gives us the fields, .role gets the role field value
                // if role is missing for some reason, fall back to "Resident"
                finalRole = roleSnapshot.data().role || "Resident";
            }
            
            // save it in our global variable so other parts of the code can use it
            currentCachedUserRole = finalRole;

            // reset the role badge's classes first before adding new ones
            roleBadge.className = "role-indicator-tag"; 

            if (finalRole === "Admin") {
                // this person is an admin, so show them the admin interface

                // set the badge text and color to red (admin-tag class in css)
                roleBadge.innerText = "[Admin Account]";
                roleBadge.classList.add("admin-tag");
                
                // show admin nav links and hide resident ones
                adminLinks.classList.remove("hidden");
                residentLinks.classList.add("hidden");
                clearSidebarActiveLinks("adminLinks"); // highlight the first admin nav button

                // take them to the admin dashboard first
                navigateToPage("adminDashboardPage"); 

                // load all the admin-specific features
                initializeAdminLiveInflowFeed();    // start the real-time notification feed for admins
                setupLiveDashboardCounters("Admin", user.email); // set up the stats cards
                loadRegisteredResidents();           // load the residents table

            } else {
                // this person is a regular resident

                // set the badge text and color to blue (resident-tag class in css)
                roleBadge.innerText = "[Resident Account]";
                roleBadge.classList.add("resident-tag");
                
                // show resident nav links and hide admin ones
                residentLinks.classList.remove("hidden");
                adminLinks.classList.add("hidden");
                clearSidebarActiveLinks("residentLinks"); // highlight the first resident nav button

                // take them to the resident dashboard
                navigateToPage("residentDashboardPage"); 

                // load resident-specific features
                initializeResidentNotificationsFeed(user.email); // their personal notifications
                setupLiveDashboardCounters("Resident", user.email); // their own stats cards
            }
        } catch (err) { console.error("could not get user role:", err); }

    } else {
        // user is NOT logged in

        // if they're on the dashboard page without being logged in, kick them out
        // this protects the dashboard from being accessed without logging in
        if (ON_DASHBOARD_PAGE) {
            window.location.href = "index.html";
            return;
        }
        // if they're already on the login page, we don't need to do anything
    }
});

// this function resets all nav buttons, then highlights only the first one in the given group
// we call this whenever someone logs in so the right first page is active by default
function clearSidebarActiveLinks(groupContainerId) {
    // first remove "active" from every single nav button on the page
    document.querySelectorAll(".nav-link").forEach(btn => btn.classList.remove("active"));

    // then find the first button inside the group (admin or resident) and make it active
    const groupElement = document.getElementById(groupContainerId);
    if (groupElement) {
        const firstBtn = groupElement.querySelector(".nav-link");
        if (firstBtn) firstBtn.classList.add("active");
    }
}

// DOMContentLoaded fires when the html is fully loaded and ready
// we put all our event listeners here so we know the elements actually exist before we grab them
document.addEventListener("DOMContentLoaded", () => {

    // if we're on the login page, only set up the login-related stuff and stop
    // no need to set up dashboard buttons that don't exist on this page
    if (ON_LOGIN_PAGE) {
        document.getElementById("tabLogin").addEventListener("click", () => switchAuthTab('login'));
        document.getElementById("tabRegister").addEventListener("click", () => switchAuthTab('register'));
        document.getElementById("registerForm").addEventListener("submit", handleRegisterSubmit);
        document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
        return; // exit early, the code below is only for the dashboard page
    }

    // everything below this line only runs on the dashboard page

    // attach the submit handler to the profile form (for saving profile changes)
    const profileForm = document.getElementById("profileForm");
    if (profileForm) profileForm.addEventListener("submit", handleProfileUpdateSubmit);

    // attach the submit handler to the document request form
    const docRequestForm = document.getElementById("docRequestForm");
    if (docRequestForm) docRequestForm.addEventListener("submit", handleDocSubmit);

    // attach the submit handler to the complaint/blotter form
    const complaintForm = document.getElementById("complaintForm");
    if (complaintForm) complaintForm.addEventListener("submit", handleComplaintSubmit);

    // attach the submit handler for posting announcements (admins only)
    const adminAnnouncementForm = document.getElementById("adminAnnouncementForm");
    if (adminAnnouncementForm) adminAnnouncementForm.addEventListener("submit", handleAnnouncementSubmit);

    // attach the click handler to the logout button in the sidebar
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);

    // set up all sidebar nav buttons so clicking them switches the visible page
    // we loop through all of them and attach the same click listener to each
    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const targetPageId = e.currentTarget.getAttribute("data-target"); // get which page to show
            document.querySelectorAll(".nav-link").forEach(lnk => lnk.classList.remove("active")); // deactivate all
            e.currentTarget.classList.add("active"); // mark clicked one as active
            navigateToPage(targetPageId); // show the target page
        });
    });

    // when the "notify me via sms" checkbox is ticked in the doc request form,
    // show the sms number input field and make it required
    // when unticked, hide it and remove the required attribute
    const docNotifSms = document.getElementById("docNotifSms");
    if (docNotifSms) docNotifSms.addEventListener("change", (e) => {
        document.getElementById("docSmsGroup").classList.toggle("hidden", !e.target.checked);
        if(e.target.checked) document.getElementById("docSmsNumber").setAttribute("required", "true");
        else document.getElementById("docSmsNumber").removeAttribute("required");
    });

    // same sms toggle logic but for the complaint form
    const complaintNotifSms = document.getElementById("complaintNotifSms");
    if (complaintNotifSms) complaintNotifSms.addEventListener("change", (e) => {
        document.getElementById("complaintSmsGroup").classList.toggle("hidden", !e.target.checked);
        if(e.target.checked) document.getElementById("complaintSmsNumber").setAttribute("required", "true");
        else document.getElementById("complaintSmsNumber").removeAttribute("required");
    });

    // when the user picks a payment method, check if they chose gcash
    // if yes, show the reference number field and pop open the qr code
    const paymentSelect = document.getElementById("paymentMethod");
    if (paymentSelect) paymentSelect.addEventListener("change", handlePaymentDropdownChange);
    
    // when the user picks a document type from the dropdown,
    // automatically update the processing fee shown below the dropdown
    const docTypeSelect = document.getElementById("docType");
    if (docTypeSelect) docTypeSelect.addEventListener("change", updateFormPriceDisplay);

    // the X button inside the qr code popup closes it
    const closeQrBtn = document.getElementById("closeQrBtn");
    if (closeQrBtn) closeQrBtn.addEventListener("click", toggleQrModal);

    // the "got it" or confirm button inside the qr popup also closes it
    const confirmQrBtn = document.getElementById("confirmQrBtn");
    if (confirmQrBtn) confirmQrBtn.addEventListener("click", toggleQrModal);
    
    // start listening to the database for document requests and complaints
    // this is what keeps the tables updated in real time without refreshing
    initializeDataPipelineMonitors();

    // also load the announcements board
    initializeLiveBulletinBoard();
});

// this function handles switching which "page" is visible in the dashboard
// the dashboard is actually one html file with many sections,
// we just show one at a time and hide the rest (like fake pages)
function navigateToPage(targetPageId) {
    // first hide every page section that exists
    document.querySelectorAll(".page-view").forEach(view => {
        view.classList.add("hidden");
        view.classList.remove("active");
    });
    
    // then only show the one we actually want
    const targetView = document.getElementById(targetPageId);
    if (targetView) {
        targetView.classList.remove("hidden");
        targetView.classList.add("active");
    }
}


/* ============================================================
   part 2 - dashboard stat counters (the cards at the top)
   these numbers update automatically whenever the database changes
   ============================================================ */

// this sets up the live counters at the top of the dashboard
// admins see different stats than residents, so we check the role first
function setupLiveDashboardCounters(role, email) {
    if (role === "Admin") {

        // admin counter 1: count how many users have the "Resident" role
        // onSnapshot listens forever and re-runs whenever user_roles changes
        const unsubUsers = onSnapshot(collection(db, "user_roles"), (snap) => {
            let totalResidents = 0;
            snap.forEach(d => { if(d.data().role === "Resident") totalResidents++; });
            const elem = document.getElementById("statAdminResidents");
            if(elem) elem.innerText = totalResidents; // update the number on screen
        });
        activeDashboardStatsUnsubscribers.push(unsubUsers); // save the unsub function for later

        // admin counter 2: count pending docs, approved docs, and total fees collected
        // we loop through all document requests and tally them based on status
        const unsubDocs = onSnapshot(docRequestColl, (snap) => {
            let pending = 0; let approved = 0; let cashVolume = 0;
            snap.forEach(d => {
                const data = d.data();
                if(data.status === "Pending") pending++;
                if(data.status === "Ready for Pickup") approved++;
                // only add the fee if it's approved (not if it's still pending)
                if(data.status === "Ready for Pickup" && data.processingFee) {
                    cashVolume += parseFloat(data.processingFee);
                }
            });
            const pElem = document.getElementById("statAdminPendingDocs");
            const iElem = document.getElementById("statAdminIssuedDocs");
            const cElem = document.getElementById("statAdminCollections");
            if(pElem) pElem.innerText = pending;
            if(iElem) iElem.innerText = approved;
            if(cElem) cElem.innerText = `₱${cashVolume.toFixed(2)}`; // toFixed(2) = 2 decimal places like ₱50.00
        });
        activeDashboardStatsUnsubscribers.push(unsubDocs);

        // admin counter 3: how many complaints are still open (still "Pending")
        const unsubComplaints = onSnapshot(complaintsColl, (snap) => {
            let openReports = 0;
            snap.forEach(d => { if(d.data().status === "Pending") openReports++; });
            const elem = document.getElementById("statAdminOpenComplaints");
            if(elem) elem.innerText = openReports;
        });
        activeDashboardStatsUnsubscribers.push(unsubComplaints);

        // admin counter 4: how many announcements currently exist
        // snap.size is just the total number of documents in the snapshot
        const unsubNotices = onSnapshot(announcementColl, (snap) => {
            const elem = document.getElementById("statAdminActiveNotices");
            if(elem) elem.innerText = snap.size;
        });
        activeDashboardStatsUnsubscribers.push(unsubNotices);

    } else {
        // this is for residents - they only see their own requests, not everyone's

        // resident counter 1: their own document requests
        // we use query + where to only get requests where userEmail matches theirs
        const unsubResDocs = onSnapshot(query(docRequestColl, where("userEmail", "==", email)), (snap) => {
            let total = 0; let pending = 0; let ready = 0;
            snap.forEach(d => {
                const data = d.data();
                // skip archived ones, the resident doesn't need to see those
                if (data.status !== "Archived by Admin") {
                    total++;
                    if(data.status === "Pending") pending++;
                    if(data.status === "Ready for Pickup") ready++;
                }
            });
            const tElem = document.getElementById("statResTotalDocs");
            const pElem = document.getElementById("statResPendingDocs");
            const rElem = document.getElementById("statResReadyDocs");
            if(tElem) tElem.innerText = total;
            if(pElem) pElem.innerText = pending;
            if(rElem) rElem.innerText = ready;
        });
        activeDashboardStatsUnsubscribers.push(unsubResDocs);

        // resident counter 2: their own complaints/blotter reports
        const unsubResReports = onSnapshot(query(complaintsColl, where("userEmail", "==", email)), (snap) => {
            let totalReports = 0;
            let pendingReports = 0;
            let closedReports = 0;

            snap.forEach(d => {
                const data = d.data();
                // again, skip archived ones
                if (data.status !== "Archived by Admin") {
                    totalReports++;
                    if (data.status === "Pending") {
                        pendingReports++;
                    } else if (data.status === "Resolved Case") {
                        closedReports++;
                    }
                }
            });

            const totalElem = document.getElementById("statResTotalReports");
            const pendingElem = document.getElementById("statResPendingReports");
            const closedElem = document.getElementById("statResClosedReports");

            if(totalElem) totalElem.innerText = totalReports;
            if(pendingElem) pendingElem.innerText = pendingReports;
            if(closedElem) closedElem.innerText = closedReports;
        });
        activeDashboardStatsUnsubscribers.push(unsubResReports);
    }
}

// shows or hides the qr code popup
// classList.toggle("hidden") adds "hidden" if it's not there, removes it if it is
function toggleQrModal() {
    const modal = document.getElementById("qrModal");
    if (modal) modal.classList.toggle("hidden");
}

// this runs when the user changes the payment method dropdown
// if they pick "GCash", show the reference number field and open the qr code popup
// for any other payment method, just hide the reference field
function handlePaymentDropdownChange() {
    const mode = document.getElementById("paymentMethod").value;
    const refGroup = document.getElementById("referenceGroup");
    const refInput = document.getElementById("paymentRef");

    if (mode === "GCash (Manual)") {
        refGroup.classList.remove("hidden"); // show the reference number field
        refInput.setAttribute("required", "true"); // make it required so they can't skip it
        toggleQrModal(); // pop open the qr code so they know where to scan
    } else {
        refGroup.classList.add("hidden"); // hide it for other payment methods
        refInput.removeAttribute("required"); // no longer required
        refInput.value = ""; // clear any value that was there before
    }
}

// whenever the user picks a document type from the dropdown,
// this function looks up its price in our BARANGAY_PRICING_SHEET object
// and updates the price display on the form
function updateFormPriceDisplay() {
    const selectedDoc = document.getElementById("docType").value;
    const priceDisplay = document.getElementById("priceDisplay");
    if (priceDisplay) {
        // if the doc type isn't in our list for some reason, default to 0.00
        const cost = BARANGAY_PRICING_SHEET[selectedDoc] !== undefined ? BARANGAY_PRICING_SHEET[selectedDoc] : 0.00;
        priceDisplay.innerText = `₱${cost.toFixed(2)}`;
    }
}


/* ============================================================
   part 3 - register, login, logout, and profile stuff
   ============================================================ */

// this handles the register form submission
// async because we need to wait for firebase to create the account
async function handleRegisterSubmit(e) {
    e.preventDefault(); // very important! stops the page from refreshing on submit

    const email = document.getElementById("regEmail").value;
    const password = document.getElementById("regPassword").value;
    const chosenRole = document.getElementById("accountRole").value; // "Admin" or "Resident"

    // gather all the extra profile info from the form
    // we'll save all of this to firestore after creating the auth account
    const profileData = {
        fullName: document.getElementById("regFullName").value,
        contactNumber: document.getElementById("regContact").value,
        dateOfBirth: document.getElementById("regDob").value,
        sex: document.getElementById("regSex").value,
        civilStatus: document.getElementById("regCivilStatus").value,
        completeAddress: document.getElementById("regAddressStr").value,
        occupation: document.getElementById("regOccupation").value,
        isSeniorCitizen: document.getElementById("regIsSenior").checked, // true or false
        isPwd: document.getElementById("regIsPwd").checked               // true or false
    };

    try {
        // step 1: create the account in firebase auth (handles email/password)
        // this gives us back a userCredential object which contains the new user's info
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // step 2: save the profile info and role to firestore
        // we use setDoc so we can set the document id to the user's uid
        // that way we can always find this user's data using their uid
        // the ...profileData spreads all the fields from our profileData object into this document
        await setDoc(doc(db, "user_roles", userCredential.user.uid), {
            email: email, 
            role: chosenRole, 
            createdOn: serverTimestamp(), // firebase fills in the exact time automatically
            ...profileData
        });
        alert("Account registration finalized.");
        document.getElementById("registerForm").reset(); // clear the form after success
    } catch (err) { alert("Registration Failed: " + err.message); }
}

// handles the login form submission
async function handleLoginSubmit(e) {
    e.preventDefault(); // stop page refresh
    try { 
        // firebase checks the email and password, throws an error if wrong
        await signInWithEmailAndPassword(auth, document.getElementById("loginEmail").value, document.getElementById("loginPassword").value); 
        // if successful, onAuthStateChanged fires automatically and handles the redirect
    } 
    catch (err) { alert("Authentication Denied."); }
}

// handles logout - we ask first just to be safe
async function handleLogout() { 
    if(confirm("Terminate session?")) await signOut(auth); 
    // after signOut, onAuthStateChanged fires again and redirects them to the login page
}

// switches between the login tab and register tab on the login page
// we just show one form and hide the other depending on which tab is clicked
function switchAuthTab(mode) {
    const loginForm = document.getElementById("loginForm"); 
    const registerForm = document.getElementById("registerForm");
    const tabLogin = document.getElementById("tabLogin"); 
    const tabRegister = document.getElementById("tabRegister");

    if(mode === 'login') {
        loginForm.classList.remove("hidden"); 
        registerForm.classList.add("hidden");
        tabLogin.classList.add("active");    // highlight the login tab
        tabRegister.classList.remove("active");
    } else {
        registerForm.classList.remove("hidden"); 
        loginForm.classList.add("hidden");
        tabRegister.classList.add("active");    // highlight the register tab
        tabLogin.classList.remove("active");
    }
}

// fetches the user's saved profile from firestore and fills in the profile form
// this runs automatically after login so the form isn't empty
async function syncUserProfileViewDetails(uid, email) {
    const emailField = document.getElementById("profEmail");
    if (emailField) emailField.value = email; // fill in email right away since we already have it
    
    try {
        // fetch the user's document from the "user_roles" collection using their uid
        const userDoc = await getDoc(doc(db, "user_roles", uid));
        if (userDoc.exists()) {
            const d = userDoc.data(); // d is just a shorthand for the data object
            // fill in each field only if the element actually exists on this page
            // we check first because some elements might not be present depending on the page
            if (document.getElementById("profFullName")) document.getElementById("profFullName").value = d.fullName || "";
            if (document.getElementById("profContact")) document.getElementById("profContact").value = d.contactNumber || "";
            if (document.getElementById("profDob")) document.getElementById("profDob").value = d.dateOfBirth || "";
            if (document.getElementById("profSex")) document.getElementById("profSex").value = d.sex || "Male";
            if (document.getElementById("profCivilStatus")) document.getElementById("profCivilStatus").value = d.civilStatus || "Single";
            if (document.getElementById("profAddressStr")) document.getElementById("profAddressStr").value = d.completeAddress || "";
            if (document.getElementById("profOccupation")) document.getElementById("profOccupation").value = d.occupation || "";
            if (document.getElementById("profIsSenior")) document.getElementById("profIsSenior").checked = !!d.isSeniorCitizen; // !! converts to true/false
            if (document.getElementById("profIsPwd")) document.getElementById("profIsPwd").checked = !!d.isPwd;
        }
    } catch (err) { console.error("error loading profile data:", err); }
}

// handles saving the updated profile when the user clicks save in the profile section
async function handleProfileUpdateSubmit(e) {
    e.preventDefault(); // stop page refresh
    const user = auth.currentUser; // get the currently logged in user
    if (!user) return; // if no one is logged in, stop

    // collect all the new values from the profile form
    const payload = {
        fullName: document.getElementById("profFullName").value,
        contactNumber: document.getElementById("profContact").value,
        dateOfBirth: document.getElementById("profDob").value,
        sex: document.getElementById("profSex").value,
        civilStatus: document.getElementById("profCivilStatus").value,
        completeAddress: document.getElementById("profAddressStr").value,
        occupation: document.getElementById("profOccupation").value,
        isSeniorCitizen: document.getElementById("profIsSenior").checked,
        isPwd: document.getElementById("profIsPwd").checked
    };

    try {
        // merge: true is important here - it means we only update the fields in payload
        // without it, setDoc would delete everything else (like their email and role)
        await setDoc(doc(db, "user_roles", user.uid), payload, { merge: true });
        alert("Profile changes applied securely.");
    } catch (err) { alert("Failed to save changes: " + err.message); }
}


/* ============================================================
   part 4 - form submissions (document request and complaint)
   ============================================================ */

// handles submitting a new document request
async function handleDocSubmit(e) {
    e.preventDefault();
    const currentUser = auth.currentUser;
    const selectedDoc = document.getElementById("docType").value;

    // look up the fee from our pricing object
    // if the doc type isn't in the list for some reason, default to 0.00
    const calculatedFee = BARANGAY_PRICING_SHEET[selectedDoc] !== undefined ? BARANGAY_PRICING_SHEET[selectedDoc] : 0.00;
    const userEmailStr = currentUser ? currentUser.email : "anonymous@domain.com";

    try {
        // save all the request details as a new document in the "document_requests" collection
        await addDoc(docRequestColl, {
            userEmail: userEmailStr,
            fullName: document.getElementById("reqName").value,
            address: document.getElementById("reqAddress").value,
            documentType: selectedDoc,
            purpose: document.getElementById("reqPurpose").value,
            processingFee: calculatedFee,
            paymentMethod: document.getElementById("paymentMethod").value,
            referenceNumber: document.getElementById("paymentRef").value || "N/A", // "N/A" if no ref number
            status: "Pending", // all new requests start as pending
            updatedBy: "System (Initialization)", // no admin has touched it yet
            timestamp: serverTimestamp(), // firebase auto-fills the current time
            prefSmsNotification: document.getElementById("docNotifSms").checked,
            smsContactNumber: document.getElementById("docNotifSms").checked ? document.getElementById("docSmsNumber").value : "N/A",
            prefEmailNotification: document.getElementById("docNotifEmail").checked
        });

        // also send a notification to all residents so they know a new request came in
        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS", // special value meaning broadcast to everyone
            title: "New Request Dispatch",
            message: `Filing requested for ${selectedDoc} under purpose: "${document.getElementById("reqPurpose").value}"`,
            updatedBy: userEmailStr,
            type: "Document",
            timestamp: serverTimestamp()
        });

        alert("Document processing request filed successfully!");
        document.getElementById("docRequestForm").reset(); // clear the form
        document.getElementById("docSmsGroup").classList.add("hidden"); // hide the sms field again
    } catch (err) { console.error(err); }
}

// handles submitting a new complaint/blotter report
async function handleComplaintSubmit(e) {
    e.preventDefault();
    const currentUser = auth.currentUser;
    const userEmailStr = currentUser ? currentUser.email : "anonymous@domain.com";

    try {
        // save the complaint to the "complaints" collection in firestore
        await addDoc(complaintsColl, {
            userEmail: userEmailStr,
            complainant: document.getElementById("complainantName").value,
            subject: document.getElementById("complaintSubject").value,
            incidentLocation: document.getElementById("incidentLocation").value,
            details: document.getElementById("complaintDetails").value,
            status: "Pending",
            updatedBy: "System (Initialization)",
            timestamp: serverTimestamp(),
            prefSmsNotification: document.getElementById("complaintNotifSms").checked,
            smsContactNumber: document.getElementById("complaintNotifSms").checked ? document.getElementById("complaintSmsNumber").value : "N/A",
            prefEmailNotification: document.getElementById("complaintNotifEmail").checked
        });

        // send a notification to everyone about the new complaint
        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS",
            title: "New Case Created",
            message: `A localized security issue regarding "${document.getElementById("complaintSubject").value}" has been submitted.`,
            updatedBy: userEmailStr,
            type: "Blotter",
            timestamp: serverTimestamp()
        });

        alert("Official security report filed.");
        document.getElementById("complaintForm").reset();
        document.getElementById("complaintSmsGroup").classList.add("hidden");
    } catch (err) { console.error(err); }
}

// handles posting a new announcement - only admins should be able to reach this
async function handleAnnouncementSubmit(e) {
    e.preventDefault();

    // extra check just in case someone tries to call this without being an admin
    if(currentCachedUserRole !== "Admin") { alert("Access denied."); return; }

    const activeAdmin = auth.currentUser ? auth.currentUser.email : "Administrative Executive";
    const title = document.getElementById("announcementTitle").value;
    const content = document.getElementById("announcementContent").value;

    try {
        // save the announcement to firestore
        await addDoc(announcementColl, {
            title: title, content: content, postedBy: activeAdmin, timestamp: serverTimestamp()
        });

        // notify all residents that there's a new announcement
        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS", 
            title: `New Notice: ${title}`,
            message: `A new public memorandum directive has been posted.`,
            updatedBy: activeAdmin, 
            type: "Announcement", 
            timestamp: serverTimestamp()
        });

        alert("Notice published to bulletin boards.");
        document.getElementById("adminAnnouncementForm").reset();
    } catch (err) { alert("Execution error: " + err.message); }
}


/* ============================================================
   part 5 - real-time tables for document requests and complaints
   these tables listen to the database and update themselves automatically
   no need to refresh the page!
   ============================================================ */

// this function sets up the two main data tables (documents and complaints)
// both use onSnapshot so they update live whenever firestore data changes
function initializeDataPipelineMonitors() {

    // this array temporarily holds records that have been archived
    // both the doc requests listener and the complaints listener can push to it
    let globalArchiveArray = [];

    // caches for search filtering
    let docCache = [];
    let blotterCache = [];

    // search filter state
    let docSearchTerm = "";
    let blotterSearchTerm = "";
    let archiveSearchTerm = "";

    // wire up the doc pipeline search input
    const docSearchInput = document.getElementById("docPipelineSearch");
    if (docSearchInput) {
        docSearchInput.addEventListener("input", (e) => {
            docSearchTerm = e.target.value.toLowerCase();
            // each cache entry is { item, id } — pass entry.item (the raw firestore data) to the matcher
            renderDocTable(docCache.filter(entry => matchesDocSearch(entry.item, docSearchTerm)));
        });
    }

    // wire up the blotter search input
    const blotterSearchInput = document.getElementById("blotterSearch");
    if (blotterSearchInput) {
        blotterSearchInput.addEventListener("input", (e) => {
            blotterSearchTerm = e.target.value.toLowerCase();
            // same — each entry is { item, id }, pass entry.item to the matcher
            renderBlotterTable(blotterCache.filter(entry => matchesBlotterSearch(entry.item, blotterSearchTerm)));
        });
    }

    // wire up the archive vault search input
    const archiveSearchInput = document.getElementById("archiveSearch");
    if (archiveSearchInput) {
        archiveSearchInput.addEventListener("input", (e) => {
            archiveSearchTerm = e.target.value.toLowerCase();
            renderArchiveTable();
        });
    }

    // helpers: check if a record matches the search term
    function matchesDocSearch(item, term) {
        if (!term) return true;
        return (
            (item.fullName?.toLowerCase().includes(term)) ||
            (item.userEmail?.toLowerCase().includes(term)) ||
            (item.documentType?.toLowerCase().includes(term)) ||
            (item.purpose?.toLowerCase().includes(term))
        );
    }

    function matchesBlotterSearch(item, term) {
        if (!term) return true;
        return (
            (item.complainant?.toLowerCase().includes(term)) ||
            (item.userEmail?.toLowerCase().includes(term)) ||
            (item.subject?.toLowerCase().includes(term)) ||
            (item.incidentLocation?.toLowerCase().includes(term)) ||
            (item.details?.toLowerCase().includes(term))
        );
    }

    function matchesArchiveSearch(item, term) {
        if (!term) return true;
        return (
            (item.callerName?.toLowerCase().includes(term)) ||
            (item.userEmail?.toLowerCase().includes(term)) ||
            (item.recordClass?.toLowerCase().includes(term)) ||
            (item.summaryData?.toLowerCase().includes(term)) ||
            (item.deletedByAdmin?.toLowerCase().includes(term))
        );
    }

    // this inner function redraws the archive table
    // we define it as a const so both listeners below can call it
    const renderArchiveTable = () => {
        const archiveBody = document.getElementById("archiveTableBody");
        if (!archiveBody) return; // if the table doesn't exist on this page, stop
        archiveBody.innerHTML = ""; // clear old rows before redrawing

        // sort archived records newest first using their timestamp
        // optional chaining (?.) handles the case where timestamp might be missing
        let filtered = globalArchiveArray.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        // apply archive search filter if there is one
        if (archiveSearchTerm) {
            filtered = filtered.filter(item => matchesArchiveSearch(item, archiveSearchTerm));
        }

        if (filtered.length === 0) {
            archiveBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No archived records match your search.</td></tr>`;
            return;
        }

        // loop through and create a table row for each archived record
        filtered.forEach((item) => {
            const tr = document.createElement("tr");
            tr.style.backgroundColor = "#fffafb"; 
            tr.innerHTML = `
                <td><strong>${item.callerName}</strong><br><small>${item.userEmail}</small></td>
                <td><b>${item.recordClass}</b></td>
                <td><i>"${item.summaryData}"</i></td>
                <td><span class="status-badge status-archived">ARCHIVED</span></td>
                <td><strong style="color:#991b1b;">${item.deletedByAdmin}</strong></td>
            `;
            archiveBody.appendChild(tr);
        });
    };

    // renders the doc pipeline table from a given data array
    function renderDocTable(data) {
        const tbody = document.getElementById("docTableBody");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No records match your search.</td></tr>`;
            return;
        }

        data.forEach(({ item, id }) => {
            const currentStatus = item.status || "Pending";
            let badgeClass = currentStatus.toLowerCase() === "ready for pickup" ? "status-approved" : "status-pending";
            const hasSmNumber = item.smsContactNumber && item.smsContactNumber !== "N/A";
            const smsLine = hasSmNumber
                ? `<br><small style="color:var(--semantic-success); font-weight:600;">📱 SMS: ${escapeHtmlText(item.smsContactNumber)}</small>`
                : `<br><small style="color:var(--text-muted);">📵 No SMS requested</small>`;
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${escapeHtmlText(item.fullName)}</strong><br><small>${escapeHtmlText(item.userEmail)}</small>${smsLine}</td>
                <td><span style="color:#1d4ed8; font-weight:700;">${escapeHtmlText(item.documentType)}</span></td>
                <td>"${escapeHtmlText(item.purpose)}"</td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td><small style="color:var(--text-muted); font-weight:600;">${escapeHtmlText(item.updatedBy || 'N/A')}</small></td>
                <td>
                    ${currentStatus.toLowerCase() === 'pending' ? `<button class="action-btn btn-approve" data-id="${id}">Approve</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="document_requests" data-id="${id}">Archive</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // renders the blotter table from a given data array
    function renderBlotterTable(data) {
        const tbody = document.getElementById("complaintTableBody");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No records match your search.</td></tr>`;
            return;
        }

        data.forEach(({ item, id }) => {
            const currentStatus = item.status || "Pending";
            let badgeClass = currentStatus.toLowerCase() === "resolved case" ? "status-resolved" : "status-pending";
            const hasSmNumber = item.smsContactNumber && item.smsContactNumber !== "N/A";
            const smsLine = hasSmNumber
                ? `<br><small style="color:var(--semantic-success); font-weight:600;">📱 SMS: ${escapeHtmlText(item.smsContactNumber)}</small>`
                : `<br><small style="color:var(--text-muted);">📵 No SMS requested</small>`;
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${escapeHtmlText(item.complainant)}</strong><br><small>📍 ${escapeHtmlText(item.incidentLocation)}</small>${smsLine}</td>
                <td><strong>${escapeHtmlText(item.subject)}</strong></td>
                <td>${escapeHtmlText(item.details)}</td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td><small style="color:var(--text-muted); font-weight:600;">${escapeHtmlText(item.updatedBy || 'N/A')}</small></td>
                <td>
                    ${currentStatus.toLowerCase() === 'pending' ? `<button class="action-btn btn-resolve" data-id="${id}">Resolve Case</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="complaints" data-id="${id}">Archive</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // listener 1: watches the document_requests collection for any changes
    // fires immediately once (to load existing data) then again whenever data changes
    onSnapshot(docRequestColl, (snapshot) => {
        const tbody = document.getElementById("docTableBody");
        if (!tbody) return;

        // clear out old "Document Request" entries from the archive array
        globalArchiveArray = globalArchiveArray.filter(x => x.recordClass !== "Document Request");

        docCache = []; // reset the doc cache

        snapshot.forEach((rec) => {
            const item = rec.data();
            const id = rec.id;
            const currentStatus = item.status || "Pending";

            if (currentStatus === "Archived by Admin") {
                globalArchiveArray.push({
                    id: id, callerName: item.fullName, userEmail: item.userEmail, recordClass: "Document Request",
                    summaryData: `${item.documentType} - ${item.purpose}`, deletedByAdmin: item.updatedBy || "Staff", timestamp: item.timestamp
                });
                return;
            }

            docCache.push({ item, id });
        });

        // apply any active search filter, then render
        renderDocTable(docCache.filter(entry => matchesDocSearch(entry.item, docSearchTerm)));
        renderArchiveTable();
    });

    // listener 2: same thing but for the complaints collection
    onSnapshot(complaintsColl, (snapshot) => {
        const tbody = document.getElementById("complaintTableBody");
        if (!tbody) return;

        globalArchiveArray = globalArchiveArray.filter(x => x.recordClass !== "Blotter Report");

        blotterCache = []; // reset the blotter cache

        snapshot.forEach((rec) => {
            const item = rec.data();
            const id = rec.id;
            const currentStatus = item.status || "Pending";

            if (currentStatus === "Archived by Admin") {
                globalArchiveArray.push({
                    id: id, callerName: item.complainant, userEmail: item.userEmail, recordClass: "Blotter Report",
                    summaryData: `Subject: ${item.subject}`, deletedByAdmin: item.updatedBy || "Staff", timestamp: item.timestamp
                });
                return;
            }

            blotterCache.push({ item, id });
        });

        // apply any active search filter, then render
        renderBlotterTable(blotterCache.filter(entry => matchesBlotterSearch(entry.item, blotterSearchTerm)));
        renderArchiveTable();
    });
}


/* ============================================================
   part 6 - button actions (approve, resolve, archive)
   instead of attaching listeners to each button individually,
   we use one listener on the whole document and check what was clicked
   this works even for buttons that are added dynamically to the page
   ============================================================ */

document.addEventListener("click", async (e) => {
    // get the current admin's email to record who made the change
    const activeAdmin = auth.currentUser ? auth.currentUser.email : "Unknown Admin";

    // check if the clicked element has the "btn-approve" class
    // if yes, it means the admin clicked the approve button on a document request row
    if (e.target.classList.contains("btn-approve")) {
        const targetId = e.target.getAttribute("data-id"); // get the id from the button's data attribute
        
        // update the status of that document request to "Ready for Pickup"
        await updateDoc(doc(db, "document_requests", targetId), { status: "Ready for Pickup", updatedBy: activeAdmin });
        
        // fetch the document request again so we can get the resident's email for the notification
        const docSnap = await getDoc(doc(db, "document_requests", targetId));
        if(docSnap.exists()){
            const info = docSnap.data();
            // send a personal notification to just that resident
            await addDoc(systemNotifColl, {
                targetResidentEmail: info.userEmail,  // only this specific resident sees this
                title: "Request Approved", 
                message: `Your ${info.documentType} is now Ready for Pickup.`,
                updatedBy: activeAdmin, 
                type: "Document", 
                timestamp: serverTimestamp()
            });
            // send email if the resident opted in
            if (info.prefEmailNotification) {
                await sendStatusUpdateEmail(
                    info.userEmail,
                    info.fullName,
                    `Your ${info.documentType} is Ready for Pickup`,
                    `Good news! Your request for a ${info.documentType} has been approved and is now ready for pickup at the Barangay Hall.\n\nPurpose: ${info.purpose}\nProcessed by: ${activeAdmin}\n\nPlease bring a valid ID when claiming your document.`,
                    activeAdmin
                );
            }
        }
    }
    
    // resolve button - admin marks a complaint case as done/resolved
    if (e.target.classList.contains("btn-resolve")) {
        const targetId = e.target.getAttribute("data-id");
        
        // update the complaint's status
        await updateDoc(doc(db, "complaints", targetId), { status: "Resolved Case", updatedBy: activeAdmin });
        
        // fetch the complaint to get the resident's email, then notify them
        const blotterSnap = await getDoc(doc(db, "complaints", targetId));
        if(blotterSnap.exists()){
            const info = blotterSnap.data();
            await addDoc(systemNotifColl, {
                targetResidentEmail: info.userEmail, 
                title: "Case Resolved", 
                message: `Grievance report "${info.subject}" completed.`,
                updatedBy: activeAdmin, 
                type: "Blotter", 
                timestamp: serverTimestamp()
            });
            // send email if the resident opted in
            if (info.prefEmailNotification) {
                await sendStatusUpdateEmail(
                    info.userEmail,
                    info.complainant,
                    `Your Case Report Has Been Resolved`,
                    `Your blotter/case report has been marked as resolved by Barangay staff.\n\nCase: ${info.subject}\nLocation: ${info.incidentLocation}\nResolved by: ${activeAdmin}\n\nYou may visit the Barangay Hall if you have any follow-up concerns.`,
                    activeAdmin
                );
            }
        }
    }
    
    // archive button - hides a record from the active tables (soft delete, doesn't permanently remove it)
    // data-coll stores which collection it's in ("document_requests" or "complaints")
    if (e.target.classList.contains("btn-archive")) {
        const targetId = e.target.getAttribute("data-id");
        const targetCollection = e.target.getAttribute("data-coll"); // could be doc requests or complaints
        
        if(confirm("Archive this record?")) {
            // fetch the record first so we can get the email to notify the resident
            const recordSnap = await getDoc(doc(db, targetCollection, targetId));
            if(recordSnap.exists()) {
                const recordData = recordSnap.data();

                // set the status to "Archived by Admin" - the tables ignore records with this status
                await updateDoc(doc(db, targetCollection, targetId), { status: "Archived by Admin", updatedBy: activeAdmin });

                // let the resident know their record was archived
                await addDoc(systemNotifColl, {
                    targetResidentEmail: recordData.userEmail, 
                    title: "Record Archived", 
                    message: `Filing history removed from current active pipelines.`,
                    updatedBy: activeAdmin, 
                    type: "Deletion Alert", 
                    timestamp: serverTimestamp()
                });

                // send email if the resident opted in
                if (recordData.prefEmailNotification) {
                    const isBlotter = targetCollection === "complaints";
                    const recordLabel = isBlotter
                        ? `Case Report: ${recordData.subject}`
                        : `Document Request: ${recordData.documentType}`;
                    await sendStatusUpdateEmail(
                        recordData.userEmail,
                        recordData.fullName || recordData.complainant,
                        `Your Filing Has Been Archived`,
                        `Your record has been archived by Barangay staff and is no longer in the active processing queue.\n\n${recordLabel}\nArchived by: ${activeAdmin}\n\nContact the Barangay Hall if you have questions about this action.`,
                        activeAdmin
                    );
                }
            }
        }
    }

    // announcement edit button - switches the card from view mode to edit mode
    if (e.target.classList.contains("btn-memo-edit")) {
        toggleAnnouncementEditView(e.target.getAttribute("data-id"));
    }

    // announcement save button - saves the edited title and content
    if (e.target.classList.contains("btn-memo-save")) {
        const targetId = e.target.getAttribute("data-id");
        await saveAnnouncementEdit(targetId, activeAdmin);
    }

    // announcement cancel button - goes back to view mode without saving
    if (e.target.classList.contains("btn-memo-cancel")) {
        toggleAnnouncementEditView(e.target.getAttribute("data-id"));
    }

    // announcement delete button - permanently removes the announcement from firestore
    if (e.target.classList.contains("btn-memo-delete")) {
        const id = e.target.getAttribute("data-id");
        if(confirm("Delete announcement permanently?")) {
            await deleteDoc(doc(db, "announcements", id)); // this is a real permanent delete
            
            // notify everyone that the announcement was removed
            await addDoc(systemNotifColl, {
                targetResidentEmail: "ALL_RESIDENTS",
                title: "Notice Terminated",
                message: `An official administrative directive has been removed from public access.`,
                updatedBy: activeAdmin,
                type: "Deletion Alert",
                timestamp: serverTimestamp()
            });
        }
    }
});


/* ============================================================
   part 7 - bulletin board / announcements section
   shows a list of announcements to residents (read-only)
   and to admins (with edit and delete buttons)
   ============================================================ */

// loads all announcements from firestore and displays them in real time
function initializeLiveBulletinBoard() {
    const residentContainer = document.getElementById("announcementContainer");
    const adminContainer = document.getElementById("adminAnnouncementContainer");

    // memo cache — populated by the onSnapshot listener, used by both render helpers
    let sortedMemosCache = [];

    // ── render helpers defined FIRST so event listeners below can safely call them ──

    function renderResidentBulletin(term) {
        if (!residentContainer) return;
        const lowerTerm = (term || "").toLowerCase().trim();
        const filtered = lowerTerm
            ? sortedMemosCache.filter(m =>
                (m.title || "").toLowerCase().includes(lowerTerm) ||
                (m.content || "").toLowerCase().includes(lowerTerm) ||
                (m.postedBy || "").toLowerCase().includes(lowerTerm)
              )
            : sortedMemosCache;

        residentContainer.innerHTML = filtered.length === 0
            ? `<p class="notif-empty-state">${lowerTerm ? 'No announcements match your search.' : 'No announcements active.'}</p>`
            : filtered.map(memo => `
                <article class="memo-document-card">
                    <div class="memo-meta-strip"><span>MEMORANDUM DIRECTIVE</span><span>Issued By: ${memo.postedBy || 'Admin'}</span></div>
                    <h4 class="memo-header-headline">📌 ${memo.title}</h4>
                    <div class="memo-body-narrative">${escapeHtmlText(memo.content)}</div>
                </article>
            `).join("");
    }

    function renderAdminBulletin(term) {
        if (!adminContainer) return;
        const lowerTerm = (term || "").toLowerCase().trim();
        const filtered = lowerTerm
            ? sortedMemosCache.filter(m =>
                (m.title || "").toLowerCase().includes(lowerTerm) ||
                (m.content || "").toLowerCase().includes(lowerTerm) ||
                (m.postedBy || "").toLowerCase().includes(lowerTerm)
              )
            : sortedMemosCache;

        adminContainer.innerHTML = filtered.length === 0
            ? `<p class="notif-empty-state">${lowerTerm ? 'No bulletins match your search.' : 'No active bulletins.'}</p>`
            : filtered.map(memo => `
                <article class="memo-document-card" id="memo-card-${memo.id}">
                    <div id="memo-static-view-${memo.id}">
                        <div class="memo-meta-strip"><span>AUTHOR HANDLES</span><span>Account Vector: ${memo.postedBy || 'Staff'}</span></div>
                        <h4 class="memo-header-headline">📌 ${memo.title}</h4>
                        <div class="memo-body-narrative">${escapeHtmlText(memo.content)}</div>
                        <div class="memo-control-toolbar">
                            <button class="action-btn btn-memo-edit" data-id="${memo.id}">✏️ Edit</button>
                            <button class="action-btn btn-memo-delete" data-id="${memo.id}">🗑️ Delete</button>
                        </div>
                    </div>
                    <div id="memo-edit-view-${memo.id}" class="inline-edit-box hidden">
                        <label style="font-size:0.75rem; font-weight:700; color:#475569; display:block; margin-bottom:4px;">EDIT DIRECTIVE TITLE</label>
                        <input type="text" id="edit-title-${memo.id}" value="${memo.title}" style="width:100%; margin-bottom:8px; padding:6px;">
                        <label style="font-size:0.75rem; font-weight:700; color:#475569; display:block; margin-bottom:4px;">EDIT BROADCAST NARRATIVE BODY</label>
                        <textarea id="edit-content-${memo.id}" rows="5" style="width:100%; padding:6px;">${memo.content}</textarea>
                        <div style="text-align: right; margin-top:8px;">
                            <button class="action-btn btn-memo-save" data-id="${memo.id}" style="background-color:var(--semantic-success); color:white;">Save Changes</button>
                            <button class="action-btn btn-memo-cancel" data-id="${memo.id}">Cancel</button>
                        </div>
                    </div>
                </article>
            `).join("");
    }

    // ── wire up search inputs (render helpers are defined above, safe to reference) ──

    const residentBulletinSearch = document.getElementById("residentBulletinSearch");
    if (residentBulletinSearch) {
        residentBulletinSearch.addEventListener("input", (e) => {
            renderResidentBulletin(e.target.value);
        });
    }

    const adminBulletinSearch = document.getElementById("adminBulletinSearch");
    if (adminBulletinSearch) {
        adminBulletinSearch.addEventListener("input", (e) => {
            renderAdminBulletin(e.target.value);
        });
    }

    // ── live listener — populates the cache and re-renders both views ──

    onSnapshot(announcementColl, (snapshot) => {
        sortedMemosCache = [];
        snapshot.forEach(d => {
            const data = d.data();
            sortedMemosCache.push({ id: d.id, title: data.title, content: data.content, postedBy: data.postedBy, timestamp: data.timestamp });
        });
        sortedMemosCache.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        // re-render both views, preserving whatever the user has already typed in the search box
        renderResidentBulletin(residentBulletinSearch ? residentBulletinSearch.value : "");
        renderAdminBulletin(adminBulletinSearch ? adminBulletinSearch.value : "");
    });
}

// toggles an announcement between view mode and edit mode
// it just swaps which div is visible using the hidden class
function toggleAnnouncementEditView(id) {
    const staticBox = document.getElementById(`memo-static-view-${id}`); // the normal view
    const editBox = document.getElementById(`memo-edit-view-${id}`);     // the edit form
    if (staticBox && editBox) {
        staticBox.classList.toggle("hidden"); // hide view, show edit (or vice versa)
        editBox.classList.toggle("hidden");
    }
}

// grabs the new title and content from the edit inputs and saves them to firestore
async function saveAnnouncementEdit(id, activeAdmin) {
    const updatedTitle = document.getElementById(`edit-title-${id}`).value;
    const updatedContent = document.getElementById(`edit-content-${id}`).value;
    try {
        // update only the title and content fields (and who updated it)
        await updateDoc(doc(db, "announcements", id), { 
            title: updatedTitle, 
            content: updatedContent,
            postedBy: activeAdmin
        });

        // let all residents know the announcement was updated
        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS",
            title: `Notice Updated: ${updatedTitle}`,
            message: `An official announcement has been re-drafted and updated.`,
            updatedBy: activeAdmin,
            type: "Announcement",
            timestamp: serverTimestamp()
        });

        alert("Announcement modifications saved.");
        toggleAnnouncementEditView(id); // go back to view mode after saving
    } catch (err) { console.error("error saving announcement edit:", err); }
}

// this function makes text safe to put inside html
// without this, if an announcement contains "<" or ">", it could break the page layout
// or even worse, let someone inject html/scripts (xss attack)
// .replace() swaps each special character with its html-safe version
function escapeHtmlText(text) {
    if(!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


/* ============================================================
   part 8 - notifications feed
   residents only see their own + broadcast notifications
   admins see literally everything in the system
   ============================================================ */

// ============================================================
// RESIDENT FILING TRACKING LOG - EXPANDED SYSTEM
// Tab A: own document requests + blotter reports with live statuses
// Tab B: community feed of all residents' submissions (no private data)
// ============================================================

// global function exposed so the HTML onclick can call it
// residents only have one tab now (their own filings), so this is kept for compatibility
window.switchTrackingTab = function(tab) {
    const myPanel = document.getElementById("trackPanelMyStatus");
    const myBtn = document.getElementById("trackTabMyStatus");
    myPanel?.classList.remove("hidden");
    myBtn?.classList.add("active");
};

// helper: format a status badge for tracking cards
function buildStatusBadge(status) {
    let cls = "status-pending";
    if (status === "Ready for Pickup") cls = "status-approved";
    if (status === "Resolved Case") cls = "status-resolved";
    if (status === "Archived by Admin") cls = "status-archived";
    return `<span class="status-badge ${cls}">${status}</span>`;
}

// TAB A - My own document requests with current statuses
function initializeMyDocumentStatusFeed(residentEmail) {
    const container = document.getElementById("myDocStatusContainer");
    if (!container) return;

    onSnapshot(query(docRequestColl, where("userEmail", "==", residentEmail)), (snapshot) => {
        let rows = [];
        let sortedDocs = [];
        snapshot.forEach(d => sortedDocs.push({ id: d.id, ...d.data() }));
        sortedDocs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        sortedDocs.forEach(item => {
            if (item.status === "Archived by Admin") return; // skip archived from this view
            const dateStr = item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleString() : "—";
            rows.push(`
                <div class="tracking-status-card">
                    <div class="tracking-card-left">
                        <div class="tracking-doc-type">${escapeHtmlText(item.documentType)}</div>
                        <div class="tracking-purpose">"${escapeHtmlText(item.purpose)}"</div>
                        <div class="tracking-meta">Filed by: <span class="tracking-email">${escapeHtmlText(item.userEmail)}</span> &nbsp;·&nbsp; ${dateStr}</div>
                    </div>
                    <div class="tracking-card-right">
                        ${buildStatusBadge(item.status)}
                        <div class="tracking-handler">Handler: <b>${escapeHtmlText(item.updatedBy || 'Awaiting')}</b></div>
                    </div>
                </div>
            `);
        });

        container.innerHTML = rows.length === 0
            ? `<p class="notif-empty-state">No document requests filed yet.</p>`
            : rows.join("");
    });
}

// TAB A - My own blotter/case reports with current statuses
function initializeMyBlotterStatusFeed(residentEmail) {
    const container = document.getElementById("myBlotterStatusContainer");
    if (!container) return;

    onSnapshot(query(complaintsColl, where("userEmail", "==", residentEmail)), (snapshot) => {
        let rows = [];
        let sortedDocs = [];
        snapshot.forEach(d => sortedDocs.push({ id: d.id, ...d.data() }));
        sortedDocs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        sortedDocs.forEach(item => {
            if (item.status === "Archived by Admin") return;
            const dateStr = item.timestamp ? new Date(item.timestamp.seconds * 1000).toLocaleString() : "—";
            rows.push(`
                <div class="tracking-status-card">
                    <div class="tracking-card-left">
                        <div class="tracking-doc-type">${escapeHtmlText(item.subject)}</div>
                        <div class="tracking-purpose">📍 ${escapeHtmlText(item.incidentLocation)}</div>
                        <div class="tracking-meta">Filed by: <span class="tracking-email">${escapeHtmlText(item.userEmail)}</span> &nbsp;·&nbsp; ${dateStr}</div>
                    </div>
                    <div class="tracking-card-right">
                        ${buildStatusBadge(item.status)}
                        <div class="tracking-handler">Handler: <b>${escapeHtmlText(item.updatedBy || 'Awaiting')}</b></div>
                    </div>
                </div>
            `);
        });

        container.innerHTML = rows.length === 0
            ? `<p class="notif-empty-state">No case reports filed yet.</p>`
            : rows.join("");
    });
}

// loads the resident's own filings only — no community-wide data exposed to residents
function initializeResidentNotificationsFeed(activeResidentEmail) {
    initializeMyDocumentStatusFeed(activeResidentEmail);
    initializeMyBlotterStatusFeed(activeResidentEmail);
}

// shows all notifications for the admin (no filter, they see everything)
// useful for admins to track all activity in the system
function initializeAdminLiveInflowFeed() {
    const adminContainer = document.getElementById("adminNotifContainer");
    if(!adminContainer) return;

    onSnapshot(systemNotifColl, (snapshot) => {
        // sort newest first
        let sortedDocs = [];
        snapshot.forEach(d => sortedDocs.push(d.data()));
        sortedDocs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        let items = [];
        sortedDocs.forEach((data) => {
            const dateStr = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleString() : new Date().toLocaleString();
            
            // same color logic as the resident feed
            let accentBorder = "var(--accent-blue)";
            if (data.type === "Blotter") accentBorder = "var(--semantic-pending)";
            if (data.type === "Deletion Alert") accentBorder = "var(--semantic-danger)";
            
            items.push(`
                <div class="log-item ${data.type === 'Blotter' ? 'blotter' : data.type === 'Deletion Alert' ? 'deletion' : 'success'}">
                    <div class="log-content">
                        <h4>${data.title}</h4>
                        <p>${data.message}</p>
                        <small style="color:var(--text-muted);">Action by: <strong>${data.updatedBy || 'Unknown'}</strong></small>
                    </div>
                    <span class="log-timestamp">${dateStr}</span>
                </div>
            `);
        });
        adminContainer.innerHTML = items.length === 0 ? `<p class="notif-empty-state">Awaiting incoming civilian transactions and filings...</p>` : items.join("");
    });
}


/* ============================================================
   part 9 - registered residents table (only visible to admins)
   shows a searchable list of all users in the system
   ============================================================ */

// this temporarily stores the residents list so we can filter it without re-fetching
// every time the admin types in the search box, we filter this array instead of calling firestore again
let residentsCache = [];

// loads all registered users from firestore and sets up the search feature
function loadRegisteredResidents() {
    const tableBody = document.getElementById("residentTableBody");
    const searchInput = document.getElementById("residentSearch");

    // listen to user_roles in real time - if a new user registers, the table updates automatically
    onSnapshot(collection(db, "user_roles"), (snapshot) => {
        residentsCache = []; // clear the old cache before refilling it
        snapshot.forEach((doc) => {
            const data = doc.data();
            // spread the data into the object and also include the doc id
            residentsCache.push({ id: doc.id, ...data });
        });
        renderResidentsTable(residentsCache); // show all residents by default (no filter)
    });

    // as the admin types in the search box, filter the cached residents array
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase(); // convert search text to lowercase for case-insensitive matching
            const filtered = residentsCache.filter(r => 
                (r.fullName?.toLowerCase().includes(query)) ||  // match by name
                (r.email?.toLowerCase().includes(query))        // or by email
            );
            renderResidentsTable(filtered); // re-render with only the matching residents
        });
    }
}

// builds and displays the residents table rows using whatever array of data is passed in
// we separate this from loadRegisteredResidents so we can call it from the search filter too
function renderResidentsTable(data) {
    const tableBody = document.getElementById("residentTableBody");
    if (!tableBody) return; // stop if element doesn't exist on this page
    
    // .map() loops through each user and returns an html string for their table row
    // .join("") combines all the strings into one big string
    tableBody.innerHTML = data.map(user => {
        // combine sex and civil status into one column to save space
        const sexStatus = `${user.sex || 'N/A'} / ${user.civilStatus || 'N/A'}`;
        
        return `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${user.fullName || 'N/A'}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${user.email || 'N/A'}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${user.completeAddress || 'N/A'}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${sexStatus}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${user.occupation || 'N/A'}</td>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-formal);">${user.role || 'Resident'}</td>
        </tr>
    `;
    }).join("");
}