// Firebase Functions para manejo de objetos perdidos
import { 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot,
    query,
    orderBy,
    where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Variable global para la base de datos
let db;

// Función para inicializar Firebase
export function initializeFirebase(database) {
    db = database;
}

// Función para agregar un objeto perdido
export async function addLostObject(objectData) {
    try {
        const docRef = await addDoc(collection(db, "lostObjects"), {
            ...objectData,
            timestamp: new Date(),
            found: false
        });
        console.log("Document written with ID: ", docRef.id);
        return docRef.id;
    } catch (error) {
        console.error("Error adding document: ", error);
        throw error;
    }
}

// Función para obtener todos los objetos perdidos
export async function getAllLostObjects() {
    try {
        const querySnapshot = await getDocs(collection(db, "lostObjects"));
        const objects = [];
        querySnapshot.forEach((doc) => {
            objects.push({ id: doc.id, ...doc.data() });
        });
        return objects.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
        console.error("Error getting documents: ", error);
        throw error;
    }
}

// Función para actualizar el estado de un objeto (encontrado/pendiente)
export async function updateObjectStatus(objectId, found) {
    try {
        const objectRef = doc(db, "lostObjects", objectId);
        await updateDoc(objectRef, {
            found: found
        });
        console.log("Document updated successfully");
    } catch (error) {
        console.error("Error updating document: ", error);
        throw error;
    }
}

// Función para eliminar un objeto
export async function deleteLostObject(objectId) {
    try {
        await deleteDoc(doc(db, "lostObjects", objectId));
        console.log("Document deleted successfully");
    } catch (error) {
        console.error("Error deleting document: ", error);
        throw error;
    }
}

// Función para escuchar cambios en tiempo real
export function listenToLostObjects(callback) {
    try {
        const q = query(collection(db, "lostObjects"), orderBy("timestamp", "desc"));
        
        return onSnapshot(q, (querySnapshot) => {
            const objects = [];
            querySnapshot.forEach((doc) => {
                objects.push({ id: doc.id, ...doc.data() });
            });
            callback(objects);
        }, (error) => {
            console.error("Error listening to documents: ", error);
        });
    } catch (error) {
        console.error("Error setting up listener: ", error);
        throw error;
    }
}

// Función para filtrar objetos por categoría
export async function getObjectsByCategory(category) {
    try {
        const q = query(
            collection(db, "lostObjects"), 
            where("category", "==", category),
            orderBy("timestamp", "desc")
        );
        const querySnapshot = await getDocs(q);
        const objects = [];
        querySnapshot.forEach((doc) => {
            objects.push({ id: doc.id, ...doc.data() });
        });
        return objects;
    } catch (error) {
        console.error("Error getting documents by category: ", error);
        throw error;
    }
}
