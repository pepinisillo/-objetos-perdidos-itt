// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBLs15N57LuOelGabv_BQP2ezxGUbVHMJM",
  authDomain: "objetos-perdidos-itt.firebaseapp.com",
  projectId: "objetos-perdidos-itt",
  storageBucket: "objetos-perdidos-itt.firebasestorage.app",
  messagingSenderId: "280785026201",
  appId: "1:280785026201:web:233c74537e622b40614c08"
};

// Exportar la configuración
if (typeof module !== 'undefined' && module.exports) {
  module.exports = firebaseConfig;
} else {
  window.firebaseConfig = firebaseConfig;
}
