// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAIEstUAUtRTmHEy5l8kq1MfgVRl-gLSI4",
  authDomain: "doa-general-store.firebaseapp.com",
  projectId: "doa-general-store",
  storageBucket: "doa-general-store.firebasestorage.app",
  messagingSenderId: "628381673146",
  appId: "1:628381673146:web:dc0406d6de48a8a2168483"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export { app };
