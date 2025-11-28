// Sistema de autenticación seguro con Firebase (SDK por CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, getDoc, collection, addDoc, getDocs, deleteDoc, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Inicializar Firebase usando la config global expuesta por firebase-config.js
const app = initializeApp(window.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Variables globales
let currentUser = null;
let isAdminLoggedIn = false;

// Función para verificar si el usuario es administrador
async function isUserAdmin(uid) {
    try {
        console.log('Verificando si UID es admin:', uid);
        // Soportar ambas rutas de colección: 'admins' (recomendado) y 'Admin' (como en tu captura)
        try {
            const docAdmins = await getDoc(doc(db, 'admins', uid));
            if (docAdmins.exists()) {
                console.log('UID encontrado en colección "admins"');
                return true;
            }
        } catch (e) {
            console.log('No se pudo acceder a colección "admins"');
        }
        
        try {
            const docAdminLegacy = await getDoc(doc(db, 'Admin', uid));
            const found = docAdminLegacy.exists();
            console.log('UID encontrado en colección "Admin"?', found);
            return found;
        } catch (e) {
            console.log('No se pudo acceder a colección "Admin"');
        }
        
        return false;
    } catch (error) {
        console.error('Error verificando admin:', error);
        return false;
    }
}

// Función de login seguro
async function secureAdminLogin(email, password) {
    try {
        console.log('Iniciando login con Firebase...');
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log('Usuario autenticado:', user.email, 'UID:', user.uid);
        
        // Verificar si es admin
        const isAdmin = await isUserAdmin(user.uid);
        
        if (isAdmin) {
            currentUser = user;
            isAdminLoggedIn = true;
            console.log('Login exitoso como admin');
            return { success: true, user: user };
        } else {
            // Si no es admin, cerrar sesión
            console.log('Usuario no es admin, cerrando sesión');
            await signOut(auth);
            return { success: false, error: 'Usuario no autorizado. Contacta al administrador.' };
        }
    } catch (error) {
        console.error('Error en login:', error);
        return { success: false, error: error.message };
    }
}

// Función para cerrar sesión
async function secureLogout() {
    try {
        await signOut(auth);
        currentUser = null;
        isAdminLoggedIn = false;
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Escuchar cambios en el estado de autenticación (desactivado temporalmente)
// onAuthStateChanged(auth, async (user) => {
//     if (user) {
//         const isAdmin = await isUserAdmin(user.uid);
//         if (isAdmin) {
//             currentUser = user;
//             isAdminLoggedIn = true;
//             console.log('Admin autenticado:', user.email);
//         }
//     } else {
//         currentUser = null;
//         isAdminLoggedIn = false;
//         console.log('Usuario desautenticado');
//     }
// });

// Funciones seguras para manejar objetos
async function addLostObjectSecure(objectData) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No autorizado - no hay sesión activa');
    }
    
    // Verificar si es admin antes de agregar
    const isAdmin = await isUserAdmin(user.uid);
    if (!isAdmin) {
        throw new Error('No autorizado - usuario no es admin');
    }
    
    try {
        const docRef = await addDoc(collection(db, 'lostObjects'), {
            ...objectData,
            addedBy: user.uid,
            addedAt: new Date(),
            timestamp: Date.now()
        });
        return { success: true, id: docRef.id };
    } catch (error) {
        // Detectar error de tamaño de Firestore
        if (error.message.includes('exceeds the maximum') || error.message.includes('too large') || error.code === 'invalid-argument') {
            throw new Error('La imagen es demasiado grande. Intenta con una imagen mas pequena o de menor resolucion.');
        }
        throw new Error('Error agregando objeto: ' + error.message);
    }
}

async function deleteLostObjectSecure(objectId) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No autorizado - no hay sesión activa');
    }
    
    // Verificar si es admin antes de eliminar
    const isAdmin = await isUserAdmin(user.uid);
    if (!isAdmin) {
        throw new Error('No autorizado - usuario no es admin');
    }
    
    try {
        await deleteDoc(doc(db, 'lostObjects', objectId));
        return { success: true };
    } catch (error) {
        throw new Error('Error eliminando objeto: ' + error.message);
    }
}

async function getAllLostObjectsSecure() {
    try {
        const querySnapshot = await getDocs(collection(db, 'lostObjects'));
        const objects = [];
        querySnapshot.forEach((doc) => {
            objects.push({ id: doc.id, ...doc.data() });
        });
        return objects;
    } catch (error) {
        throw new Error('Error obteniendo objetos: ' + error.message);
    }
}

// Escuchar cambios en tiempo real
function listenToLostObjectsSecure(callback) {
    const user = auth.currentUser;
    if (!user) {
        console.error('No autorizado para escuchar cambios - no hay sesión');
        return;
    }
    
    return onSnapshot(collection(db, 'lostObjects'), (snapshot) => {
        const objects = [];
        snapshot.forEach((doc) => {
            objects.push({ id: doc.id, ...doc.data() });
        });
        callback(objects);
    });
}

// Exportar funciones
export {
    secureAdminLogin,
    secureLogout,
    addLostObjectSecure,
    deleteLostObjectSecure,
    getAllLostObjectsSecure,
    listenToLostObjectsSecure,
    isAdminLoggedIn,
    currentUser
};

// Guard utilitario para páginas de administrador
export function guardAdminPage(redirectUrl = 'admin-login.html') {
    return new Promise((resolve) => {
        // Usar onAuthStateChanged solo aquí para no cerrar sesión automáticamente
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').then(({ onAuthStateChanged }) => {
            onAuthStateChanged(auth, async (user) => {
                if (!user) {
                    window.location.href = redirectUrl;
                    return;
                }
                const ok = await isUserAdmin(user.uid);
                if (!ok) {
                    await signOut(auth);
                    window.location.href = redirectUrl;
                    return;
                }
                resolve(true);
            });
        });
    });
}
