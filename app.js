// ====== CDN MODULE IMPORT ROUTING DIRECTIVES ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, where, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== INTEGRATED CORE FIREBASE CONFIGURATION OBJECT ======
const firebaseConfig = {
    apiKey: "AIzaSyBZ70EKMokniSj2qDcMiHw3jSxt6qH157g",
    authDomain: "barangay-e-governance-system.firebaseapp.com",
    projectId: "barangay-e-governance-system", 
    storageBucket: "barangay-e-governance-system.firebasestorage.app",
    messagingSenderId: "98530921404",
    appId: "1:98530921404:web:e28508e919fa05d62bb9b9",
    measurementId: "G-R3E94KGYXW"
};

// Initialize App Connection Handles
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const docRequestColl = collection(db, "document_requests");
const complaintsColl = collection(db, "complaints");
const systemNotifColl = collection(db, "system_notifications"); 
const announcementColl = collection(db, "announcements");

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

let currentCachedUserRole = "Resident";
let activeDashboardStatsUnsubscribers = [];

/* ==========================================================
   1. AUTHENTICATION STATE LOGIC & REDIRECTION
   ========================================================== */
onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname;
    const isLoginPage = path.includes("login.html") || path === "/" || path === "/index.html" === false;

    if (user) {
        // If user IS logged in, ensure they are on index.html
        if (isLoginPage && !path.includes("index.html")) {
            window.location.href = "index.html";
            return;
        }

        const logoutBtn = document.getElementById("logoutBtn");
        const userBadgeWrapper = document.getElementById("userBadgeWrapper");
        const userBadge = document.getElementById("userBadge");
        const roleBadge = document.getElementById("roleBadge");
        const sidebarMenu = document.getElementById("sidebarMenu");
        const residentLinks = document.getElementById("residentLinks");
        const adminLinks = document.getElementById("adminLinks");

        activeDashboardStatsUnsubscribers.forEach(unsub => unsub());
        activeDashboardStatsUnsubscribers = [];

        if (userBadge) userBadge.innerText = user.email.split('@')[0];
        if (userBadgeWrapper) userBadgeWrapper.classList.remove("hidden");
        if (logoutBtn) logoutBtn.classList.remove("hidden");
        if (sidebarMenu) sidebarMenu.classList.remove("hidden");

        syncUserProfileViewDetails(user.uid, user.email);

        try {
            const roleSnapshot = await getDoc(doc(db, "user_roles", user.uid));
            let finalRole = roleSnapshot.exists() ? roleSnapshot.data().role : "Resident";
            
            currentCachedUserRole = finalRole;
            roleBadge.className = "role-indicator-tag"; 

            if (finalRole === "Admin") {
                roleBadge.innerText = "[Admin Account]";
                roleBadge.classList.add("admin-tag");
                adminLinks.classList.remove("hidden");
                residentLinks.classList.add("hidden");
                clearSidebarActiveLinks("adminLinks");
                navigateToPage("adminDashboardPage"); 
                initializeAdminLiveInflowFeed();
                setupLiveDashboardCounters("Admin", user.email);
                loadRegisteredResidents();
            } else {
                roleBadge.innerText = "[Resident Account]";
                roleBadge.classList.add("resident-tag");
                residentLinks.classList.remove("hidden");
                adminLinks.classList.add("hidden");
                clearSidebarActiveLinks("residentLinks");
                navigateToPage("residentDashboardPage"); 
                initializeResidentNotificationsFeed(user.email);
                setupLiveDashboardCounters("Resident", user.email);
            }
        } catch (err) { console.error("Access classification lookup failed:", err); }

    } else {
        // If user IS NOT logged in, ensure they are on login.html
        if (!isLoginPage && !path.includes("login.html")) {
            window.location.href = "login.html";
        }
    }
});

// [Rest of your existing functions: clearSidebarActiveLinks, document.addEventListener DOMContentLoaded, navigateToPage, setupLiveDashboardCounters, etc., remain exactly as you had them]

function clearSidebarActiveLinks(groupContainerId) {
    document.querySelectorAll(".nav-link").forEach(btn => btn.classList.remove("active"));
    const groupElement = document.getElementById(groupContainerId);
    if (groupElement) {
        const firstBtn = groupElement.querySelector(".nav-link");
        if (firstBtn) firstBtn.classList.add("active");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Check if elements exist before adding listeners to avoid null errors on the wrong page
    if(document.getElementById("tabLogin")) document.getElementById("tabLogin").addEventListener("click", () => switchAuthTab('login'));
    if(document.getElementById("tabRegister")) document.getElementById("tabRegister").addEventListener("click", () => switchAuthTab('register'));

    if(document.getElementById("registerForm")) document.getElementById("registerForm").addEventListener("submit", handleRegisterSubmit);
    if(document.getElementById("loginForm")) document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
    if(document.getElementById("profileForm")) document.getElementById("profileForm").addEventListener("submit", handleProfileUpdateSubmit);
    if(document.getElementById("docRequestForm")) document.getElementById("docRequestForm").addEventListener("submit", handleDocSubmit);
    if(document.getElementById("complaintForm")) document.getElementById("complaintForm").addEventListener("submit", handleComplaintSubmit);
    if(document.getElementById("adminAnnouncementForm")) document.getElementById("adminAnnouncementForm").addEventListener("submit", handleAnnouncementSubmit);
    if(document.getElementById("logoutBtn")) document.getElementById("logoutBtn").addEventListener("click", handleLogout);

    document.querySelectorAll(".nav-link").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const targetPageId = e.currentTarget.getAttribute("data-target");
            document.querySelectorAll(".nav-link").forEach(lnk => lnk.classList.remove("active"));
            e.currentTarget.classList.add("active");
            navigateToPage(targetPageId);
        });
    });

    if(document.getElementById("docNotifSms")) document.getElementById("docNotifSms").addEventListener("change", (e) => {
        document.getElementById("docSmsGroup").classList.toggle("hidden", !e.target.checked);
        if(e.target.checked) document.getElementById("docSmsNumber").setAttribute("required", "true");
        else document.getElementById("docSmsNumber").removeAttribute("required");
    });
    
    if(document.getElementById("complaintNotifSms")) document.getElementById("complaintNotifSms").addEventListener("change", (e) => {
        document.getElementById("complaintSmsGroup").classList.toggle("hidden", !e.target.checked);
        if(e.target.checked) document.getElementById("complaintSmsNumber").setAttribute("required", "true");
        else document.getElementById("complaintSmsNumber").removeAttribute("required");
    });

    const paymentSelect = document.getElementById("paymentMethod");
    if (paymentSelect) paymentSelect.addEventListener("change", handlePaymentDropdownChange);
    
    const docTypeSelect = document.getElementById("docType");
    if (docTypeSelect) docTypeSelect.addEventListener("change", updateFormPriceDisplay);

    if(document.getElementById("closeQrBtn")) document.getElementById("closeQrBtn").addEventListener("click", toggleQrModal);
    if(document.getElementById("confirmQrBtn")) document.getElementById("confirmQrBtn").addEventListener("click", toggleQrModal);
    
    initializeDataPipelineMonitors();
    initializeLiveBulletinBoard();
});

function navigateToPage(targetPageId) {
    document.querySelectorAll(".page-view").forEach(view => {
        view.classList.add("hidden");
        view.classList.remove("active");
    });
    
    const targetView = document.getElementById(targetPageId);
    if (targetView) {
        targetView.classList.remove("hidden");
        targetView.classList.add("active");
    }
}

/* ==========================================================
   2. REAL-TIME STATISTICAL WIDGET METRIC SYNC ENGINE
   ========================================================== */
function setupLiveDashboardCounters(role, email) {
    if (role === "Admin") {
        const unsubUsers = onSnapshot(collection(db, "user_roles"), (snap) => {
            let totalResidents = 0;
            snap.forEach(d => { if(d.data().role === "Resident") totalResidents++; });
            const elem = document.getElementById("statAdminResidents");
            if(elem) elem.innerText = totalResidents;
        });
        activeDashboardStatsUnsubscribers.push(unsubUsers);

        const unsubDocs = onSnapshot(docRequestColl, (snap) => {
            let pending = 0; let approved = 0; let cashVolume = 0;
            snap.forEach(d => {
                const data = d.data();
                if(data.status === "Pending") pending++;
                if(data.status === "Ready for Pickup") approved++;
                if(data.status === "Ready for Pickup" && data.processingFee) {
                    cashVolume += parseFloat(data.processingFee);
                }
            });
            const pElem = document.getElementById("statAdminPendingDocs");
            const iElem = document.getElementById("statAdminIssuedDocs");
            const cElem = document.getElementById("statAdminCollections");
            if(pElem) pElem.innerText = pending;
            if(iElem) iElem.innerText = approved;
            if(cElem) cElem.innerText = `₱${cashVolume.toFixed(2)}`;
        });
        activeDashboardStatsUnsubscribers.push(unsubDocs);

        const unsubComplaints = onSnapshot(complaintsColl, (snap) => {
            let openReports = 0;
            snap.forEach(d => { if(d.data().status === "Pending") openReports++; });
            const elem = document.getElementById("statAdminOpenComplaints");
            if(elem) elem.innerText = openReports;
        });
        activeDashboardStatsUnsubscribers.push(unsubComplaints);

        const unsubNotices = onSnapshot(announcementColl, (snap) => {
            const elem = document.getElementById("statAdminActiveNotices");
            if(elem) elem.innerText = snap.size;
        });
        activeDashboardStatsUnsubscribers.push(unsubNotices);

    } else {
        // [RESIDENT SNAPSHOT] Real-Time Document Registry Metrics Setup
        const unsubResDocs = onSnapshot(query(docRequestColl, where("userEmail", "==", email)), (snap) => {
            let total = 0; let pending = 0; let ready = 0;
            snap.forEach(d => {
                const data = d.data();
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

        // [RESIDENT SNAPSHOT] Real-Time Complaint Reports Status Splitting Logic
        const unsubResReports = onSnapshot(query(complaintsColl, where("userEmail", "==", email)), (snap) => {
            let totalReports = 0;
            let pendingReports = 0;
            let closedReports = 0;

            snap.forEach(d => {
                const data = d.data();
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

function toggleQrModal() {
    const modal = document.getElementById("qrModal");
    if (modal) modal.classList.toggle("hidden");
}

function handlePaymentDropdownChange() {
    const mode = document.getElementById("paymentMethod").value;
    const refGroup = document.getElementById("referenceGroup");
    const refInput = document.getElementById("paymentRef");

    if (mode === "GCash (Manual)") {
        refGroup.classList.remove("hidden");
        refInput.setAttribute("required", "true");
        toggleQrModal();
    } else {
        refGroup.classList.add("hidden");
        refInput.removeAttribute("required");
        refInput.value = "";
    }
}

function updateFormPriceDisplay() {
    const selectedDoc = document.getElementById("docType").value;
    const priceDisplay = document.getElementById("priceDisplay");
    if (priceDisplay) {
        const cost = BARANGAY_PRICING_SHEET[selectedDoc] !== undefined ? BARANGAY_PRICING_SHEET[selectedDoc] : 0.00;
        priceDisplay.innerText = `₱${cost.toFixed(2)}`;
    }
}

/* ==========================================================
   3. IDENTITY PROFILE MANAGEMENT SYSTEMS
   ========================================================== */
async function handleRegisterSubmit(e) {
    e.preventDefault();
    const email = document.getElementById("regEmail").value;
    const password = document.getElementById("regPassword").value;
    const chosenRole = document.getElementById("accountRole").value;

    const profileData = {
        fullName: document.getElementById("regFullName").value,
        contactNumber: document.getElementById("regContact").value,
        dateOfBirth: document.getElementById("regDob").value,
        sex: document.getElementById("regSex").value,
        civilStatus: document.getElementById("regCivilStatus").value,
        completeAddress: document.getElementById("regAddressStr").value,
        occupation: document.getElementById("regOccupation").value,
        isSeniorCitizen: document.getElementById("regIsSenior").checked,
        isPwd: document.getElementById("regIsPwd").checked
    };

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "user_roles", userCredential.user.uid), {
            email: email, 
            role: chosenRole, 
            createdOn: serverTimestamp(),
            ...profileData
        });
        alert("Account registration finalized.");
        document.getElementById("registerForm").reset();
    } catch (err) { alert("Registration Failed: " + err.message); }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    try { await signInWithEmailAndPassword(auth, document.getElementById("loginEmail").value, document.getElementById("loginPassword").value); } 
    catch (err) { alert("Authentication Denied."); }
}

async function handleLogout() { if(confirm("Terminate session?")) await signOut(auth); }

function switchAuthTab(mode) {
    const loginForm = document.getElementById("loginForm"); const registerForm = document.getElementById("registerForm");
    const tabLogin = document.getElementById("tabLogin"); const tabRegister = document.getElementById("tabRegister");
    if(mode === 'login') {
        loginForm.classList.remove("hidden"); registerForm.classList.add("hidden");
        tabLogin.classList.add("active"); tabRegister.classList.remove("active");
    } else {
        registerForm.classList.remove("hidden"); loginForm.classList.add("hidden");
        tabRegister.classList.add("active"); tabLogin.classList.remove("active");
    }
}

async function syncUserProfileViewDetails(uid, email) {
    const emailField = document.getElementById("profEmail");
    if (emailField) emailField.value = email;
    
    try {
        const userDoc = await getDoc(doc(db, "user_roles", uid));
        if (userDoc.exists()) {
            const d = userDoc.data();
            if (document.getElementById("profFullName")) document.getElementById("profFullName").value = d.fullName || "";
            if (document.getElementById("profContact")) document.getElementById("profContact").value = d.contactNumber || "";
            if (document.getElementById("profDob")) document.getElementById("profDob").value = d.dateOfBirth || "";
            if (document.getElementById("profSex")) document.getElementById("profSex").value = d.sex || "Male";
            if (document.getElementById("profCivilStatus")) document.getElementById("profCivilStatus").value = d.civilStatus || "Single";
            if (document.getElementById("profAddressStr")) document.getElementById("profAddressStr").value = d.completeAddress || "";
            if (document.getElementById("profOccupation")) document.getElementById("profOccupation").value = d.occupation || "";
            if (document.getElementById("profIsSenior")) document.getElementById("profIsSenior").checked = !!d.isSeniorCitizen;
            if (document.getElementById("profIsPwd")) document.getElementById("profIsPwd").checked = !!d.isPwd;
        }
    } catch (err) { console.error("Error drawing profile data:", err); }
}

async function handleProfileUpdateSubmit(e) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

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
        // Secure atomic update merge routine
        await setDoc(doc(db, "user_roles", user.uid), payload, { merge: true });
        alert("Profile changes applied securely.");
    } catch (err) { alert("Failed to save changes: " + err.message); }
}

/* ==========================================================
   4. CIVILIAN INTAKE TRANSMISSION OPERATIONS
   ========================================================== */
async function handleDocSubmit(e) {
    e.preventDefault();
    const currentUser = auth.currentUser;
    const selectedDoc = document.getElementById("docType").value;
    const calculatedFee = BARANGAY_PRICING_SHEET[selectedDoc] !== undefined ? BARANGAY_PRICING_SHEET[selectedDoc] : 0.00;
    const userEmailStr = currentUser ? currentUser.email : "anonymous@domain.com";

    try {
        await addDoc(docRequestColl, {
            userEmail: userEmailStr,
            fullName: document.getElementById("reqName").value,
            address: document.getElementById("reqAddress").value,
            documentType: selectedDoc,
            purpose: document.getElementById("reqPurpose").value,
            processingFee: calculatedFee,
            paymentMethod: document.getElementById("paymentMethod").value,
            referenceNumber: document.getElementById("paymentRef").value || "N/A",
            status: "Pending",
            updatedBy: "System (Initialization)",
            timestamp: serverTimestamp(),
            prefSmsNotification: document.getElementById("docNotifSms").checked,
            smsContactNumber: document.getElementById("docNotifSms").checked ? document.getElementById("docSmsNumber").value : "N/A"
        });

        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS",
            title: "New Request Dispatch",
            message: `Filing requested for ${selectedDoc} under purpose: "${document.getElementById("reqPurpose").value}"`,
            updatedBy: userEmailStr,
            type: "Document",
            timestamp: serverTimestamp()
        });

        alert("Document processing request filed successfully!");
        document.getElementById("docRequestForm").reset();
        document.getElementById("docSmsGroup").classList.add("hidden");
    } catch (err) { console.error(err); }
}

async function handleComplaintSubmit(e) {
    e.preventDefault();
    const currentUser = auth.currentUser;
    const userEmailStr = currentUser ? currentUser.email : "anonymous@domain.com";

    try {
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
            smsContactNumber: document.getElementById("complaintNotifSms").checked ? document.getElementById("complaintSmsNumber").value : "N/A"
        });

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

async function handleAnnouncementSubmit(e) {
    e.preventDefault();
    if(currentCachedUserRole !== "Admin") { alert("Access denied."); return; }

    const activeAdmin = auth.currentUser ? auth.currentUser.email : "Administrative Executive";
    const title = document.getElementById("announcementTitle").value;
    const content = document.getElementById("announcementContent").value;

    try {
        await addDoc(announcementColl, {
            title: title, content: content, postedBy: activeAdmin, timestamp: serverTimestamp()
        });

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

/* ==========================================================
   5. REAL-TIME REGISTRY LOG RECONCILIATION MONITORS
   ========================================================== */
function initializeDataPipelineMonitors() {
    let globalArchiveArray = [];

    const renderArchiveTable = () => {
        const archiveBody = document.getElementById("archiveTableBody");
        if (!archiveBody) return;
        archiveBody.innerHTML = "";
        globalArchiveArray.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        globalArchiveArray.forEach((item) => {
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

    onSnapshot(docRequestColl, (snapshot) => {
        const tbody = document.getElementById("docTableBody");
        if (!tbody) return; tbody.innerHTML = "";
        globalArchiveArray = globalArchiveArray.filter(x => x.recordClass !== "Document Request");

        snapshot.forEach((rec) => {
            const item = rec.data(); const id = rec.id; const currentStatus = item.status || "Pending";
            if (currentStatus === "Archived by Admin") {
                globalArchiveArray.push({
                    id: id, callerName: item.fullName, userEmail: item.userEmail, recordClass: "Document Request",
                    summaryData: `${item.documentType} - ${item.purpose}`, deletedByAdmin: item.updatedBy || "Staff", timestamp: item.timestamp
                });
                return; 
            }
            let badgeClass = currentStatus.toLowerCase() === "ready for pickup" ? "status-approved" : "status-pending";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.fullName}</strong><br><small>${item.userEmail}</small></td>
                <td><span style="color:#1d4ed8; font-weight:700;">${item.documentType}</span></td>
                <td>"${item.purpose}"</td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td><small style="color:var(--text-muted); font-weight:600;">${item.updatedBy || 'N/A'}</small></td>
                <td>
                    ${currentStatus.toLowerCase() === 'pending' ? `<button class="action-btn btn-approve" data-id="${id}">Approve</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="document_requests" data-id="${id}">Archive</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        renderArchiveTable();
    });

    onSnapshot(complaintsColl, (snapshot) => {
        const tbody = document.getElementById("complaintTableBody");
        if (!tbody) return; tbody.innerHTML = "";
        globalArchiveArray = globalArchiveArray.filter(x => x.recordClass !== "Blotter Report");

        snapshot.forEach((rec) => {
            const item = rec.data(); const id = rec.id; const currentStatus = item.status || "Pending";
            if (currentStatus === "Archived by Admin") {
                globalArchiveArray.push({
                    id: id, callerName: item.complainant, userEmail: item.userEmail, recordClass: "Blotter Report",
                    summaryData: `Subject: ${item.subject}`, deletedByAdmin: item.updatedBy || "Staff", timestamp: item.timestamp
                });
                return;
            }
            let badgeClass = currentStatus.toLowerCase() === "resolved case" ? "status-resolved" : "status-pending";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.complainant}</strong><br><small>📍 ${item.incidentLocation}</small></td>
                <td><strong>${item.subject}</strong></td>
                <td>${item.details}</td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td><small style="color:var(--text-muted); font-weight:600;">${item.updatedBy || 'N/A'}</small></td>
                <td>
                    ${currentStatus.toLowerCase() === 'pending' ? `<button class="action-btn btn-resolve" data-id="${id}">Resolve Case</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="complaints" data-id="${id}">Archive</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        renderArchiveTable();
    });
}

/* ==========================================================
   6. INTERACTIVE ACTION REGISTER MODERATORS & EVENT CONTROL
   ========================================================== */
document.addEventListener("click", async (e) => {
    const activeAdmin = auth.currentUser ? auth.currentUser.email : "Unknown Admin";

    if (e.target.classList.contains("btn-approve")) {
        const targetId = e.target.getAttribute("data-id");
        await updateDoc(doc(db, "document_requests", targetId), { status: "Ready for Pickup", updatedBy: activeAdmin });
        
        const docSnap = await getDoc(doc(db, "document_requests", targetId));
        if(docSnap.exists()){
            const info = docSnap.data();
            await addDoc(systemNotifColl, {
                targetResidentEmail: info.userEmail, 
                title: "Request Approved", 
                message: `Your ${info.documentType} is now Ready for Pickup.`,
                updatedBy: activeAdmin, 
                type: "Document", 
                timestamp: serverTimestamp()
            });
        }
    }
    
    if (e.target.classList.contains("btn-resolve")) {
        const targetId = e.target.getAttribute("data-id");
        await updateDoc(doc(db, "complaints", targetId), { status: "Resolved Case", updatedBy: activeAdmin });
        
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
        }
    }
    
    if (e.target.classList.contains("btn-archive")) {
        const targetId = e.target.getAttribute("data-id");
        const targetCollection = e.target.getAttribute("data-coll"); 
        
        if(confirm("Archive this record?")) {
            const recordSnap = await getDoc(doc(db, targetCollection, targetId));
            if(recordSnap.exists()) {
                const recordData = recordSnap.data();
                await updateDoc(doc(db, targetCollection, targetId), { status: "Archived by Admin", updatedBy: activeAdmin });
                await addDoc(systemNotifColl, {
                    targetResidentEmail: recordData.userEmail, 
                    title: "Record Archived", 
                    message: `Filing history removed from current active pipelines.`,
                    updatedBy: activeAdmin, 
                    type: "Deletion Alert", 
                    timestamp: serverTimestamp()
                });
            }
        }
    }

    if (e.target.classList.contains("btn-memo-edit")) {
        toggleAnnouncementEditView(e.target.getAttribute("data-id"));
    }
    if (e.target.classList.contains("btn-memo-save")) {
        const targetId = e.target.getAttribute("data-id");
        await saveAnnouncementEdit(targetId, activeAdmin);
    }
    if (e.target.classList.contains("btn-memo-cancel")) {
        toggleAnnouncementEditView(e.target.getAttribute("data-id"));
    }
    if (e.target.classList.contains("btn-memo-delete")) {
        const id = e.target.getAttribute("data-id");
        if(confirm("Delete announcement permanently?")) {
            await deleteDoc(doc(db, "announcements", id));
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

/* ==========================================================
   7. REAL-TIME BULLETIN BOARDS STREAMS
   ========================================================== */
function initializeLiveBulletinBoard() {
    const residentContainer = document.getElementById("announcementContainer");
    const adminContainer = document.getElementById("adminAnnouncementContainer");

    onSnapshot(announcementColl, (snapshot) => {
        let sortedMemos = [];
        snapshot.forEach(d => {
            const data = d.data();
            sortedMemos.push({ id: d.id, title: data.title, content: data.content, postedBy: data.postedBy, timestamp: data.timestamp });
        });
        sortedMemos.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        if (residentContainer) {
            residentContainer.innerHTML = sortedMemos.length === 0 ? `<p class="notif-empty-state">No announcements active.</p>` : sortedMemos.map(memo => `
                <article class="memo-document-card">
                    <div class="memo-meta-strip"><span>MEMORANDUM DIRECTIVE</span><span>Issued By: ${memo.postedBy || 'Admin'}</span></div>
                    <h4 class="memo-header-headline">📌 ${memo.title}</h4>
                    <div class="memo-body-narrative">${escapeHtmlText(memo.content)}</div>
                </article>
            `).join("");
        }

        if (adminContainer) {
            adminContainer.innerHTML = sortedMemos.length === 0 ? `<p class="notif-empty-state">No active bulletins.</p>` : sortedMemos.map(memo => `
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
    });
}

function toggleAnnouncementEditView(id) {
    const staticBox = document.getElementById(`memo-static-view-${id}`);
    const editBox = document.getElementById(`memo-edit-view-${id}`);
    if (staticBox && editBox) {
        staticBox.classList.toggle("hidden");
        editBox.classList.toggle("hidden");
    }
}

async function saveAnnouncementEdit(id, activeAdmin) {
    const updatedTitle = document.getElementById(`edit-title-${id}`).value;
    const updatedContent = document.getElementById(`edit-content-${id}`).value;
    try {
        await updateDoc(doc(db, "announcements", id), { 
            title: updatedTitle, 
            content: updatedContent,
            postedBy: activeAdmin
        });

        await addDoc(systemNotifColl, {
            targetResidentEmail: "ALL_RESIDENTS",
            title: `Notice Updated: ${updatedTitle}`,
            message: `An official announcement has been re-drafted and updated.`,
            updatedBy: activeAdmin,
            type: "Announcement",
            timestamp: serverTimestamp()
        });

        alert("Announcement modifications saved.");
        toggleAnnouncementEditView(id);
    } catch (err) { console.error("Error executing memo update:", err); }
}

function escapeHtmlText(text) {
    if(!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ==========================================================
   8. REAL-TIME ACCOUNTABILITY LOG FEEDS
   ========================================================== */

// Helper to format the HTML log
function createLogHtml(data, dateStr) {
    let typeClass = "";
    if (data.type === "Blotter") typeClass = "blotter";
    if (data.type === "Deletion Alert") typeClass = "deletion";
    // Add more conditions here if you have other types

    return `
        <div class="log-item ${typeClass}">
            <div class="log-content">
                <h4>${data.title}</h4>
                <p>${data.message}</p>
                <small style="color:var(--text-muted);">Action by: <b>${data.updatedBy || 'System'}</b></small>
            </div>
            <span class="log-timestamp">${dateStr}</span>
        </div>
    `;
}

function initializeResidentNotificationsFeed(activeResidentEmail) {
    const container = document.getElementById("residentNotifContainer");
    if (!container) return;

    onSnapshot(systemNotifColl, (snapshot) => {
        let items = [];
        snapshot.forEach(d => {
            const data = d.data();
            if (data.targetResidentEmail === activeResidentEmail || data.targetResidentEmail === "ALL_RESIDENTS") {
                const dateStr = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleString() : new Date().toLocaleString();
                items.push({ data, dateStr });
            }
        });

        // Sort by newest
        items.sort((a, b) => (b.data.timestamp?.seconds || 0) - (a.data.timestamp?.seconds || 0));
        
        container.innerHTML = items.length === 0 
            ? `<p class="notif-empty-state">No notification history.</p>` 
            : items.map(item => createLogHtml(item.data, item.dateStr)).join("");
    });
}

// Repeat similar logic for initializeAdminLiveInflowFeed by calling createLogHtml

// 1. Global variable to hold resident data
let residentsCache = [];

// 2. Consolidated load and filter function
function loadRegisteredResidents() {
    const tableBody = document.getElementById("residentTableBody");
    const searchInput = document.getElementById("residentSearch");

    onSnapshot(collection(db, "user_roles"), (snapshot) => {
        residentsCache = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            // We store everything in the cache for filtering
            residentsCache.push({ id: doc.id, ...data });
        });
        // Initial render
        renderResidentsTable(residentsCache);
    });

    // Add filter listener only once
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = residentsCache.filter(r => 
                (r.fullName?.toLowerCase().includes(query)) || 
                (r.email?.toLowerCase().includes(query))
            );
            renderResidentsTable(filtered);
        });
    }
}

// 3. Centralized render function
function renderResidentsTable(data) {
    const tableBody = document.getElementById("residentTableBody");
    if (!tableBody) return;
    
    tableBody.innerHTML = data.map(user => {
        // Concatenating Sex and Civil Status for the display column
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