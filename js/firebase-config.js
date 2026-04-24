// GuardianHQ - Firebase + Auth configuratie
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfda3IcQk-bbYHOqKhU4r8wMtOCPjTztc",
  authDomain: "guardianhq-db216.firebaseapp.com",
  projectId: "guardianhq-db216",
  storageBucket: "guardianhq-db216.firebasestorage.app",
  messagingSenderId: "370272351292",
  appId: "1:370272351292:web:4496bd3fbad791e0fa7f39"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, doc, setDoc, getDoc };
