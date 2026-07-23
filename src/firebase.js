import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCFIxeW8SyNp3we2ogNbhDQ_DVz3OFHJ2g",
  authDomain: "startup-peravai.firebaseapp.com",
  projectId: "startup-peravai",
  storageBucket: "startup-peravai.firebasestorage.app",
  messagingSenderId: "188162882355",
  appId: "1:188162882355:web:df573dfb12d07605645c46",
  measurementId: "G-RT5TMZWDS7",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
