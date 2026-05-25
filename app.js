// ====== CDN MODULE IMPORT ROUTING DIRECTIVES ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ====== YOUR INTEGRATED CORE FIREBASE CONFIGURATION OBJECT ======
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

// Data Collection Target Vectors
const docRequestColl = collection(db, "document_requests");
const complaintsColl = collection(db, "complaints");

/* ==========================================================
   1. AUTHENTICATION CONTROLLER STATE LOGIC & SMART FILTERING
   ========================================================== */

onAuthStateChanged(auth, async (user) => {
    const authSec = document.getElementById("authSection");
    const residentSec = document.getElementById("residentSection");
    const adminSec = document.getElementById("adminSection");
    const logoutBtn = document.getElementById("logoutBtn");
    const userBadge = document.getElementById("userBadge");

    if (user) {
        userBadge.innerText = user.email;
        userBadge.classList.remove("hidden");
        logoutBtn.classList.remove("hidden");
        authSec.classList.add("hidden");

        try {
            const roleSnapshot = await getDoc(doc(db, "user_roles", user.uid));
            if (roleSnapshot.exists()) {
                const userData = roleSnapshot.data();
                
                if (userData.role === "Admin") {
                    adminSec.classList.remove("hidden");
                    residentSec.classList.add("hidden");
                    console.log("Admin clearance verified. Displaying administrative panel.");
                } else {
                    residentSec.classList.remove("hidden");
                    adminSec.classList.add("hidden");
                    console.log("Resident clearance verified. Displaying public services terminal.");
                }
            } else {
                // Fallback route: If auth exists but no matching Firestore role document is discovered
                console.warn("User signed in, but no explicit role structure found. Defaulting to Resident view.");
                residentSec.classList.remove("hidden");
                adminSec.classList.add("hidden");
            }
        } catch (err) {
            console.error("Failed to pull verification clear path roles:", err);
        }
    } else {
        // Safe Lockout State
        authSec.classList.remove("hidden");
        residentSec.classList.add("hidden");
        adminSec.classList.add("hidden");
        logoutBtn.classList.add("hidden");
        userBadge.classList.add("hidden");
    }
});

// Setup Safe Event Listeners after DOM Hierarchy Ingestion
document.addEventListener("DOMContentLoaded", () => {
    // Auth Tab Layout Toggles
    document.getElementById("tabLogin").addEventListener("click", () => switchAuthTab('login'));
    document.getElementById("tabRegister").addEventListener("click", () => switchAuthTab('register'));

    // Secure Form Ingest Actions
    document.getElementById("registerForm").addEventListener("submit", handleRegisterSubmit);
    document.getElementById("loginForm").addEventListener("submit", handleLoginSubmit);
    document.getElementById("docRequestForm").addEventListener("submit", handleDocSubmit);
    document.getElementById("complaintForm").addEventListener("submit", handleComplaintSubmit);

    // Global Core Actions
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
});

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const email = document.getElementById("regEmail").value;
    const password = document.getElementById("regPassword").value;
    const chosenRole = document.getElementById("accountRole").value;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, "user_roles", user.uid), {
            email: email,
            role: chosenRole,
            createdOn: new Date()
        });

        alert("Account created successfully! Interface updated.");
        document.getElementById("registerForm").reset();
    } catch (err) {
        alert("Registration Failed: " + err.message);
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        alert("Authentication Denied: Invalid credentials or mismatching account record.");
    }
}

async function handleLogout() {
    if(confirm("Log out of the secure Barangay system session?")) {
        await signOut(auth);
    }
}

function switchAuthTab(mode) {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const tabLogin = document.getElementById("tabLogin");
    const tabRegister = document.getElementById("tabRegister");

    if(mode === 'login') {
        loginForm.classList.remove("hidden");
        registerForm.classList.add("hidden");
        tabLogin.classList.add("active");
        tabRegister.classList.remove("active");
    } else {
        registerForm.classList.remove("hidden");
        loginForm.classList.add("hidden");
        tabRegister.classList.add("active");
        tabLogin.classList.remove("active");
    }
}

/* ==========================================================
   2. HARDENED REAL-TIME DATA FEED PIPELINES (FIRESTORE)
   ========================================================== */

onSnapshot(docRequestColl, (snapshot) => {
    const tbody = document.getElementById("docTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    snapshot.forEach((rec) => {
        try {
            const item = rec.data();
            const id = rec.id;
            const currentStatus = item.status || "Pending";
            
            let badgeClass = "status-pending";
            if (currentStatus === "Ready for Pickup") badgeClass = "status-approved";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.fullName || 'Unknown Resident'}</strong><br><small style="color:#64748b">${item.address || 'No Address Logged'}</small></td>
                <td><span style="color:#1d4ed8; font-weight:700;">${item.documentType || 'Not Specified'}</span></td>
                <td><i>"${item.purpose || 'No purpose declared.'}"</i></td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td>
                    ${currentStatus === 'Pending' ? `<button class="action-btn btn-approve" data-id="${id}">Approve &amp; Release</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="document_requests" data-id="${id}">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        } catch (innerError) {
            console.error("Skipped rendering corrupted document entry:", innerError);
        }
    });
}, (error) => {
    console.error("Firestore Document Stream Error:", error);
});

onSnapshot(complaintsColl, (snapshot) => {
    const tbody = document.getElementById("complaintTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    snapshot.forEach((rec) => {
        try {
            const item = rec.data();
            const id = rec.id;
            const currentStatus = item.status || "Pending";
            
            let badgeClass = "status-pending";
            if (currentStatus === "Resolved Case") badgeClass = "status-resolved";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.complainant || 'Anonymous Resident'}</strong></td>
                <td><strong>${item.subject || 'No Subject Classification'}</strong></td>
                <td style="max-width:300px; font-size:0.95rem; color:#475569">${item.details || 'No narrative details matching event.'}</td>
                <td><span class="status-badge ${badgeClass}">${currentStatus}</span></td>
                <td>
                    ${currentStatus === 'Pending' ? `<button class="action-btn btn-resolve" data-id="${id}">Resolve Case</button>` : ''}
                    <button class="action-btn btn-archive" data-coll="complaints" data-id="${id}">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        } catch (innerError) {
            console.error("Skipped rendering corrupted complaint entry:", innerError);
        }
    });
}, (error) => {
    console.error("Firestore Complaint Stream Error:", error);
});

// Event Delegation Processing for Table Submissions
document.addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-approve")) {
        const id = e.target.getAttribute("data-id");
        try {
            await updateDoc(doc(db, "document_requests", id), { status: "Ready for Pickup" });
        } catch (err) { console.error("Error updating document state:", err); }
    }
    
    if (e.target.classList.contains("btn-resolve")) {
        const id = e.target.getAttribute("data-id");
        try {
            await updateDoc(doc(db, "complaints", id), { status: "Resolved Case" });
        } catch (err) { console.error("Error updating complaint state:", err); }
    }
    
    if (e.target.classList.contains("btn-archive")) {
        const id = e.target.getAttribute("data-id");
        const coll = e.target.getAttribute("data-coll");
        if(confirm("Permanently purge this item archive entry?")) {
            try {
                await deleteDoc(doc(db, coll, id));
            } catch (err) { console.error("Error purging document entry:", err); }
        }
    }
});

async function handleDocSubmit(e) {
    e.preventDefault();
    try {
        await addDoc(docRequestColl, {
            fullName: document.getElementById("reqName").value,
            address: document.getElementById("reqAddress").value,
            documentType: document.getElementById("docType").value,
            purpose: document.getElementById("reqPurpose").value,
            status: "Pending",
            timestamp: new Date()
        });
        alert("Document processing request filed successfully!");
        document.getElementById("docRequestForm").reset();
    } catch (err) { console.error("Submission Error on Document Interface:", err); }
}

async function handleComplaintSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById("complainantName").value;
    try {
        await addDoc(complaintsColl, {
            complainant: nameInput.trim() === "" ? "Anonymous Resident" : nameInput,
            subject: document.getElementById("complaintSubject").value,
            details: document.getElementById("complaintDetails").value,
            status: "Pending",
            timestamp: new Date()
        });
        alert("Official report cataloged in security incident registries.");
        document.getElementById("complaintForm").reset();
    } catch (err) { console.error("Submission Error on Blotter Interface:", err); }
}