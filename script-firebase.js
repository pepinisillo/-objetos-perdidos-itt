// Firebase Integration para Objetos Perdidos ITT (CDN SDK + firebase-config.js)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, onSnapshot, query, orderBy, limit, getDocs, addDoc, doc, updateDoc, deleteDoc, getCountFromServer, enableNetwork, disableNetwork } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// Datos de objetos perdidos (se cargan desde Firebase o datos locales)
let lostObjects = [];
let totalObjectsCount = 0; // Total de objetos en la base de datos

// Inicializar Firebase con configuraciones optimizadas
const app = initializeApp(window.firebaseConfig);
const db = getFirestore(app);

// Configuraciones de optimización para Firebase
try {
    // Habilitar persistencia offline para mejor rendimiento
    enableNetwork(db);
    
    console.log('Firebase inicializado con optimizaciones');
    
    // Monitoreo de conexión deshabilitado
    
} catch (error) {
    console.warn('No se pudieron aplicar todas las configuraciones de Firebase:', error);
}

// Funciones de conexión removidas
const storage = getStorage(app);

// Referencias a elementos del DOM
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const closeModal = document.querySelector('.close');
const loginForm = document.getElementById('loginForm');
const adminPanel = document.getElementById('adminPanel');
const loginBtn = document.getElementById('loginBtn');
const adminPassword = document.getElementById('adminPassword');
const objectForm = document.getElementById('objectForm');
const objectsGrid = document.getElementById('objectsGrid');
const noObjects = document.getElementById('noObjects');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');
const totalObjetos = document.getElementById('totalObjetos');
const objetosEncontrados = document.getElementById('objetosEncontrados');
const adminObjectsList = document.getElementById('adminObjectsList');
const categoriesGrid = document.getElementById('categoriesGrid');

// Subida alternativa a Imgur (si no hay Storage)
async function uploadToImgur(file) {
    if (!window.IMGUR_CLIENT_ID) {
        throw new Error('IMGUR_CLIENT_ID no configurado');
    }
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch('https://api.imgur.com/3/image', {
        method: 'POST',
        headers: { Authorization: `Client-ID ${window.IMGUR_CLIENT_ID}` },
        body: formData
    });
    const data = await response.json();
    if (!response.ok || !data?.success) {
        throw new Error(data?.data?.error || 'Error subiendo a Imgur');
    }
    return data.data.link;
}

// Subida alternativa a Cloudinary (unsigned upload)
async function uploadToCloudinary(file) {
    const cloudName = window.CLOUDINARY_CLOUD_NAME;
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary no configurado (CLOUDINARY_CLOUD_NAME/UPLOAD_PRESET)');
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (!res.ok || !data?.secure_url) {
        throw new Error(data?.error?.message || 'Error subiendo a Cloudinary');
    }
    return data.secure_url;
}

// Inicializar listener en tiempo real con paginación
function startRealtimeListener() {
    // Mostrar indicador de carga
    showLoadingIndicator();
    
    // Cargar solo los primeros 10 objetos inicialmente
    loadInitialObjects();
}

// Función para cargar objetos iniciales (solo los primeros 10)
async function loadInitialObjects() {
    try {
        console.log('Cargando objetos iniciales desde Firebase...');
        
        // Intentar con timeout más corto y reintentos
        const items = await loadWithRetry();
        
        lostObjects = items;
        allObjects = items; // Inicialmente solo tenemos los primeros 10
        console.log(`Objetos iniciales cargados: ${items.length}`);
        
        // Ocultar indicador de carga
        hideLoadingIndicator();
        
        renderObjects();
        renderCategories();
        updateStats();
        
        // Cargar el total de objetos en segundo plano
        loadTotalCount();
        
        // Ahora configurar el listener en tiempo real para actualizaciones
        setupRealtimeListener();
        
    } catch (error) {
        console.error('Error cargando objetos iniciales:', error);
        hideLoadingIndicator();
        showError('Error cargando objetos. Intenta recargar la página.');
    }
}

// Función con reintentos inteligentes para cargar datos
async function loadWithRetry(maxRetries = 3, timeout = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Intento ${attempt}/${maxRetries} de carga...`);
            
            // Crear promise con timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout de conexión')), timeout);
            });
            
            const col = collection(db, 'lostObjects');
            const q = query(col, orderBy('addedAt', 'desc'), limit(10));
            
            const dataPromise = getDocs(q);
            const snapshot = await Promise.race([dataPromise, timeoutPromise]);
            
            const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            console.log(`Carga exitosa en intento ${attempt}`);
            return items;
            
        } catch (error) {
            console.warn(`Intento ${attempt} falló:`, error.message);
            
            if (attempt === maxRetries) {
                throw new Error(`No se pudo conectar después de ${maxRetries} intentos`);
            }
            
            // Esperar antes del siguiente intento (backoff exponencial)
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`Esperando ${delay}ms antes del siguiente intento...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Configurar listener en tiempo real para actualizaciones
function setupRealtimeListener() {
    const col = collection(db, 'lostObjects');
    onSnapshot(col, (snapshot) => {
        console.log('Actualizando objetos desde Firebase...');
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Ordenar en cliente por prioridad: addedAt -> timestamp -> date
        items.sort((a, b) => {
            const getTime = (o) => {
                if (o.addedAt && typeof o.addedAt.toMillis === 'function') return o.addedAt.toMillis();
                if (o.addedAt instanceof Date) return o.addedAt.getTime();
                if (typeof o.timestamp === 'number') return o.timestamp;
                if (o.date) return new Date(o.date).getTime();
                return 0;
            };
            return getTime(b) - getTime(a);
        });
        
        // Solo actualizar si hay cambios significativos
        if (items.length !== lostObjects.length) {
            lostObjects = items;
            console.log(`Objetos actualizados: ${items.length}`);
            
            renderObjects();
            renderCategories();
            updateStats();
        }
    }, (error) => {
        console.error('Firestore onSnapshot error:', error);
    });
}

// Función para cargar el total de objetos en segundo plano
async function loadTotalCount() {
    try {
        const { getCountFromServer } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const col = collection(db, 'lostObjects');
        const snapshot = await getCountFromServer(col);
        const totalCount = snapshot.data().count;
        
        console.log(`Total de objetos en la base de datos: ${totalCount}`);
        
        // Guardar el total para la paginación
        totalObjectsCount = totalCount;
        
        // Actualizar el contador sin recargar la página
        if (totalObjetos) {
            totalObjetos.textContent = String(totalCount);
        }
        
        // Actualizar paginación con el total correcto
        updatePaginationControls();
        
    } catch (error) {
        console.warn('No se pudo obtener el total de objetos:', error);
        // Si falla, usar el contador de objetos cargados
        totalObjectsCount = lostObjects.length;
        if (totalObjetos) {
            totalObjetos.textContent = String(lostObjects.length);
        }
    }
}

// Función para cargar más objetos cuando sea necesario
async function loadMoreObjectsIfNeeded() {
    if (isLoadingMore) return;
    
    const totalNeeded = currentPage * itemsPerPage;
    if (allObjects.length >= totalNeeded) return;
    
    try {
        isLoadingMore = true;
        console.log(`Cargando más objetos... (necesarios: ${totalNeeded}, actuales: ${allObjects.length})`);
        
        const { query, orderBy, limit, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const col = collection(db, 'lostObjects');
        
        // Cargar más objetos
        const q = query(
            col,
            orderBy('addedAt', 'desc'),
            limit(totalNeeded)
        );
        
        const snapshot = await getDocs(q);
        const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        
        allObjects = items;
        lostObjects = items;
        
        console.log(`Objetos cargados: ${items.length}`);
        
    } catch (error) {
        console.error('Error cargando más objetos:', error);
    } finally {
        isLoadingMore = false;
    }
}

// Función para mostrar indicador de carga
function showLoadingIndicator() {
    if (objectsGrid) {
        objectsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <p style="margin-top: 1rem; color: #666; font-size: 1.1rem;">Cargando objetos perdidos...</p>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
    }
}

// Función para ocultar indicador de carga
function hideLoadingIndicator() {
    // El indicador se reemplazará automáticamente cuando se rendericen los objetos
}

// Función para mostrar error
function showError(message) {
    if (objectsGrid) {
        objectsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #dc3545;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <p style="font-size: 1.1rem; margin-bottom: 1rem;">${message}</p>
                <button onclick="location.reload()" style="
                    background: #007bff; 
                    color: white; 
                    border: none; 
                    padding: 10px 20px; 
                    border-radius: 5px; 
                    cursor: pointer;
                ">Recargar página</button>
            </div>
        `;
    }
}

// (legacy) eliminado

// (legacy) eliminado

// Función eliminada: loadSampleData() - ya no se cargan objetos de ejemplo

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    setupImageZoom();
    // Render inicial seguro
    try {
        if (typeof renderCategories === 'function') renderCategories();
        if (typeof renderObjects === 'function') renderObjects([]);
        if (typeof updateStats === 'function') updateStats();
    } catch (e) {
        console.warn('Render inicial omitido:', e);
    }
    startRealtimeListener();
});

function setupEventListeners() {
    // Modal de administrador
    if (adminBtn && adminModal && closeModal) {
    adminBtn.addEventListener('click', () => {
        adminModal.style.display = 'block';
        if (isAdminLoggedIn) {
            showAdminPanel();
        } else {
            showLoginForm();
        }
    });

    closeModal.addEventListener('click', () => {
        adminModal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === adminModal) {
            adminModal.style.display = 'none';
        }
    });
    }

    // Si existe UI de admin embebido (opcional), podría inicializarse aquí

    // Formulario de objetos
    if (objectForm) {
    objectForm.addEventListener('submit', handleObjectSubmit);
    }

    // Búsqueda y filtros
    if (searchInput) {
    searchInput.addEventListener('input', filterObjects);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                filterObjects();
                const target = document.getElementById('objetos');
                if (target) target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
    if (categoryFilter) categoryFilter.addEventListener('change', filterObjects);

    // Navegación suave
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href');
            if (targetId.startsWith('#')) {
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth' });
                    
                    // Actualizar navegación activa
                    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                }
            }
        });
    });

    // Inicializar fecha actual en el formulario
    const objectDateInput = document.getElementById('objectDate');
    if (objectDateInput) {
    const today = new Date().toISOString().split('T')[0];
        objectDateInput.value = today;
    }

    // Event listeners para el modal de detalles
    const objectDetailsModal = document.getElementById('objectDetailsModal');
    const objectClose = document.querySelector('.object-close');
    
    if (objectClose) {
        objectClose.addEventListener('click', () => {
            objectDetailsModal.style.display = 'none';
        });
    }
    
    if (objectDetailsModal) {
        window.addEventListener('click', (e) => {
            if (e.target === objectDetailsModal) {
                objectDetailsModal.style.display = 'none';
            }
        });
    }
    
}

// (legacy) eliminado: el admin real vive en admin-panel.html

function showLoginForm() {
    loginForm.style.display = 'block';
    adminPanel.style.display = 'none';
}

function showAdminPanel() {
    loginForm.style.display = 'none';
    adminPanel.style.display = 'block';
    // renderAdminObjects() se maneja en admin-panel.html
}

// Agregar objeto (solo si mantienes formulario público con permisos)
async function handleObjectSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const imageFile = document.getElementById('objectImageFile').files[0];
    
    let imageUrl = document.getElementById('objectImage').value || getDefaultImage(document.getElementById('objectCategory').value);
    
    // Subir imagen si se seleccionó un archivo
    if (imageFile) {
        // Intentar Storage; si falla, intentar Cloudinary y luego Imgur
        try {
            showNotification('Subiendo imagen...', 'info');
            if (storage && window.USE_STORAGE !== false) {
                const imageRef = ref(storage, `objects/${Date.now()}_${imageFile.name}`);
                const snapshot = await uploadBytes(imageRef, imageFile);
                imageUrl = await getDownloadURL(snapshot.ref);
                showNotification('Imagen subida exitosamente', 'success');
            } else {
                throw new Error('Storage no configurado');
            }
        } catch (errorStorage) {
            console.warn('Storage falló, intentando Cloudinary:', errorStorage);
            try {
                imageUrl = await uploadToCloudinary(imageFile);
                showNotification('Imagen subida a Cloudinary', 'success');
            } catch (errorCld) {
                console.warn('Cloudinary falló, intentando Imgur:', errorCld);
                try {
                    imageUrl = await uploadToImgur(imageFile);
                    showNotification('Imagen subida a Imgur', 'success');
                } catch (errorImgur) {
                    console.error('Subida a Imgur falló:', errorImgur);
                    showNotification('No se pudo subir imagen. Usa una URL o configura Storage/Cloudinary/Imgur.', 'error');
                    return;
                }
            }
        }
    }
    
    const newObject = {
        name: document.getElementById('objectName').value,
        category: document.getElementById('objectCategory').value,
        description: document.getElementById('objectDescription').value,
        keywords: document.getElementById('objectKeywords').value,
        location: document.getElementById('objectLocation').value,
        date: document.getElementById('objectDate').value,
        image: imageUrl,
        addedAt: new Date()
    };

    try {
        await addDoc(collection(db, 'lostObjects'), newObject);
            showNotification('Objeto registrado exitosamente', 'success');
        objectForm.reset();
        
        // Resetear fecha a hoy
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('objectDate').value = today;
        
    } catch (error) {
        console.error("Error adding object:", error);
        showNotification('Error al registrar objeto', 'error');
    }
}

function getDefaultImage(category) {
    const defaultImages = {
        'electronico': 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&h=300&fit=crop',
        'ropa': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=300&fit=crop',
        'cuadernos': 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400&h=300&fit=crop',
        'otros': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop'
    };
    return defaultImages[category] || defaultImages['otros'];
}

function renderCategories() {
    const categories = [
        { key: 'electronico', name: 'Electrónicos', icon: 'fas fa-laptop' },
        { key: 'ropa', name: 'Ropa y Accesorios', icon: 'fas fa-tshirt' },
        { key: 'cuadernos', name: 'Cuadernos y Materiales', icon: 'fas fa-book' },
        { key: 'otros', name: 'Otros', icon: 'fas fa-box' }
    ];

    categoriesGrid.innerHTML = categories.map(category => {
        // Obtener objetos de esta categoría
        const categoryObjects = lostObjects.filter(obj => obj.category === category.key);
        const latestObjects = categoryObjects.sort((a, b) => new Date(b.addedAt || b.date) - new Date(a.addedAt || a.date)).slice(0, 4);
        const count = categoryObjects.length;

        // Crear el grid de imágenes (2x2)
        let imageGrid = '';
        
        // Mostrar hasta 4 imágenes de los objetos más recientes
        for (let i = 0; i < 4; i++) {
            if (i < latestObjects.length) {
                const obj = latestObjects[i];
                imageGrid += `<div class="category-image-item">
                    <img src="${obj.image}" alt="${obj.name}">
                </div>`;
            } else {
                imageGrid += `<div class="category-image-item fallback">
                    <i class="${category.icon}"></i>
                </div>`;
            }
        }

        return `<div class="category-card" onclick="filterByCategory('${category.key}')">
            <div class="category-image">
                ${imageGrid}
            </div>
            <div class="category-info">
                <div class="category-name">${category.name}</div>
                <div class="category-count">${count} objetos</div>
            </div>
        </div>`;
    }).join('');
}

function filterByCategory(categoryKey) {
    // Actualizar el filtro de categoría
    categoryFilter.value = categoryKey;
    
    // Filtrar objetos
    filterObjects();
    
    // Scroll hacia la sección de objetos
    document.getElementById('objetos').scrollIntoView({ behavior: 'smooth' });
}

// Hacer función global
window.filterByCategory = filterByCategory;

// Función para limpiar búsqueda
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    
    searchInput.value = '';
    categoryFilter.value = '';
    
    filterObjects(); // Ya maneja el reset de página internamente
}

// Hacer función global
window.clearSearch = clearSearch;


// Función renderAdminObjects movida al admin-panel.html

// Función para eliminar objeto (ya no se usa toggleObjectStatus)

async function deleteObject(id) {
    if (confirm('¿Estás seguro de que quieres eliminar este objeto?')) {
        try {
            await deleteDoc(doc(db, 'lostObjects', id));
                showNotification('Objeto eliminado exitosamente', 'success');
        } catch (error) {
            console.error("Error deleting object:", error);
            showNotification('Error al eliminar el objeto', 'error');
        }
    }
}

// Hacer función global
window.deleteObject = deleteObject;

function showObjectDetails(id) {
    const obj = lostObjects.find(o => o.id === id);
    if (obj) {
        // Llenar el modal con los datos del objeto
        document.getElementById('detailTitle').textContent = obj.name;
        document.getElementById('detailImage').src = obj.image;
        document.getElementById('detailImage').alt = obj.name;
        document.getElementById('detailCategory').textContent = getCategoryName(obj.category);
        document.getElementById('detailDescription').textContent = obj.description || 'Sin descripción';
        document.getElementById('detailLocation').textContent = obj.location || 'No especificado';
        document.getElementById('detailDate').textContent = formatDate(obj.date);
        
        // Mostrar el modal
        document.getElementById('objectDetailsModal').style.display = 'block';
    }
}

function filterObjects() {
    const searchTerm = normalizeText(searchInput.value);
    const selectedCategory = categoryFilter.value;

    const filtered = lostObjects.filter(obj => {
        const name = normalizeText(obj.name || '');
        const description = normalizeText(obj.description || '');
        const location = normalizeText(obj.location || '');
        const keywords = normalizeText(obj.keywords || '');
        
        const matchesSearch = !searchTerm || 
                            name.includes(searchTerm) ||
                            description.includes(searchTerm) ||
                            location.includes(searchTerm) ||
                            keywords.includes(searchTerm);
        
        const matchesCategory = !selectedCategory || obj.category === selectedCategory;

        return matchesSearch && matchesCategory;
    });

    currentPage = 1; // Reset a la primera página
    renderObjects(filtered, true); // Resetear página cuando se filtran objetos
}

// Función para normalizar texto (quitar acentos, convertir a minúsculas)
function normalizeText(text) {
    return text.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

// Variables de paginación
let currentPage = 1;
let itemsPerPage = 10;
let filteredObjects = [];
let allObjects = []; // Todos los objetos cargados
let isLoadingMore = false;

function updateStats() {
    const total = Array.isArray(lostObjects) ? lostObjects.length : 0;
    if (totalObjetos) {
        totalObjetos.textContent = String(total);
    }
}

async function renderObjects(objectsToRender = lostObjects, resetPage = true) {
    console.log('Renderizando objetos...', objectsToRender.length);
    filteredObjects = objectsToRender;
    
    // Solo resetear la página si se especifica
    if (resetPage) {
        currentPage = 1;
    }
    
    // Cargar más objetos si es necesario
    await loadMoreObjectsIfNeeded();
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageObjects = filteredObjects.slice(startIndex, endIndex);
    
    if (pageObjects.length === 0) {
        objectsGrid.style.display = 'none';
        noObjects.style.display = 'block';
        const paginationControls = document.getElementById('paginationControls');
        if (paginationControls) paginationControls.style.display = 'none';
        return;
    }

    objectsGrid.style.display = 'grid';
    noObjects.style.display = 'none';
    
    console.log(`Mostrando objetos ${startIndex + 1}-${endIndex} de ${filteredObjects.length}`);

    objectsGrid.innerHTML = pageObjects.map((obj, index) => `
        <div class="object-card" onclick="showObjectDetails('${obj.id}')" style="opacity: 0; animation: fadeInUp 0.5s ease-out forwards;" data-index="${index}">
            ${obj.image ? `<img src="${obj.image}" alt="${obj.name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" style="width: 100%; height: 200px; object-fit: cover; border-radius: 16px;">` : ''}
            <div class="no-image" style="display: ${obj.image ? 'none' : 'flex'}; width: 100%; height: 200px; background: #f8f9fa; align-items: center; justify-content: center; border-radius: 16px; color: #6c757d;">
                <i class="fas fa-image" style="font-size: 2rem;"></i>
            </div>
        </div>
    `).join('') + `
        <style>
            @keyframes fadeInUp {
                from { 
                    opacity: 0; 
                    transform: translateY(20px); 
                }
                to { 
                    opacity: 1; 
                    transform: translateY(0); 
                }
            }
        </style>
    `;
    
    // Animar elementos con delay escalonado
    setTimeout(() => {
        const cards = objectsGrid.querySelectorAll('.object-card');
        cards.forEach((card, index) => {
            card.style.animationDelay = `${index * 0.1}s`;
        });
    }, 100);
    
    updatePaginationControls();
}

function updatePaginationControls() {
    // Usar totalObjectsCount si está disponible, sino usar filteredObjects.length
    const totalObjects = totalObjectsCount > 0 ? totalObjectsCount : filteredObjects.length;
    const totalPages = Math.ceil(totalObjects / itemsPerPage);
    const paginationControls = document.getElementById('paginationControls');
    
    if (totalObjects === 0 || totalPages <= 1) {
        paginationControls.style.display = 'none';
        return;
    }
    
    paginationControls.style.display = 'flex';
    
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
    
    // Generar números de página
    generatePageNumbers(currentPage, totalPages);
}

function generatePageNumbers(currentPage, totalPages) {
    const pageNumbersContainer = document.getElementById('pageNumbers');
    
    if (!pageNumbersContainer) return;
    
    let pageNumbersHTML = '';
    const maxVisiblePages = 3; // Máximo número de páginas visibles
    
    // Calcular el rango de páginas a mostrar
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // Ajustar si estamos cerca del final
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    // Solo mostrar páginas visibles sin puntos suspensivos
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage ? 'active' : '';
        pageNumbersHTML += `<button class="page-number ${isActive}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    pageNumbersContainer.innerHTML = pageNumbersHTML;
}

async function goToPreviousPage() {
    if (currentPage > 1) {
        currentPage--;
        await renderObjects(filteredObjects, false); // No resetear página
    }
}

async function goToNextPage() {
    const totalPages = Math.ceil(filteredObjects.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        await renderObjects(filteredObjects, false); // No resetear página
        // Scroll automático hacia la sección de objetos
        const objetosSection = document.getElementById('objetos');
        if (objetosSection) {
            objetosSection.scrollIntoView({ behavior: 'smooth' });
        }
    }
}

async function changeItemsPerPage() {
    itemsPerPage = parseInt(document.getElementById('itemsPerPageSelect').value);
    currentPage = 1;
    await renderObjects(filteredObjects, true); // Resetear página cuando cambia items por página
}

async function goToPage(pageNumber) {
    const totalPages = Math.ceil(filteredObjects.length / itemsPerPage);
    if (pageNumber >= 1 && pageNumber <= totalPages) {
        const previousPage = currentPage;
        currentPage = pageNumber;
        await renderObjects(filteredObjects, false); // No resetear página
        
        // Scroll automático solo si se va hacia adelante (número mayor)
        if (pageNumber > previousPage) {
            const objetosSection = document.getElementById('objetos');
            if (objetosSection) {
                objetosSection.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }
}

// Hacer funciones globales para HTML
window.goToPreviousPage = goToPreviousPage;
window.goToNextPage = goToNextPage;
window.changeItemsPerPage = changeItemsPerPage;
window.goToPage = goToPage;
window.showObjectDetails = showObjectDetails;

// animateNumber eliminado (se usa actualización directa del contador)

function getCategoryName(category) {
    const categories = {
        'electronico': 'Electrónicos',
        'ropa': 'Ropa y Accesorios',
        'cuadernos': 'Cuadernos y Materiales',
        'otros': 'Otros'
    };
    return categories[category] || 'Otros';
}

function formatDate(dateString) {
    // Si no hay fecha o está vacía, retornar "Sin fecha"
    if (!dateString || dateString.trim() === '') {
        return 'Sin fecha';
    }
    
    const date = new Date(dateString);
    
    // Si la fecha es inválida, retornar "Sin fecha"
    if (isNaN(date.getTime())) {
        return 'Sin fecha';
    }
    
    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function showNotification(message, type = 'info') {
    // Único toast reutilizable en esquina inferior derecha
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.style.position = 'fixed';
        toast.style.right = '20px';
        toast.style.bottom = '20px';
        toast.style.padding = '12px 16px';
        toast.style.borderRadius = '8px';
        toast.style.color = '#fff';
        toast.style.fontWeight = '600';
        toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';
        toast.style.zIndex = '5000';
        toast.style.maxWidth = '320px';
        toast.style.wordBreak = 'break-word';
        document.body.appendChild(toast);
    }
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        info: '#007bff'
    };
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}

// Smooth scrolling para navegación
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Actualizar navegación activa al hacer scroll
window.addEventListener('scroll', function() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (scrollY >= (sectionTop - 200)) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + current) {
            link.classList.add('active');
        }
    });
});

// Función para configurar el zoom de imagen
function setupImageZoom() {
    const imageZoomModal = document.getElementById('imageZoomModal');
    const zoomedImage = document.getElementById('zoomedImage');
    const imageZoomClose = document.querySelector('.image-zoom-close');
    
    // Usar delegación de eventos para la imagen del modal de detalles
    document.addEventListener('click', (e) => {
        // Si se hace click en la imagen del modal de detalles
        if (e.target && e.target.id === 'detailImage') {
            const imgSrc = e.target.src;
            if (imgSrc && imgSrc !== '') {
                zoomedImage.src = imgSrc;
                imageZoomModal.classList.add('show');
            }
        }
    });
    
    // Cerrar el modal de zoom al hacer click en la X
    if (imageZoomClose) {
        imageZoomClose.addEventListener('click', (e) => {
            e.stopPropagation();
            imageZoomModal.classList.remove('show');
        });
    }
    
    // Cerrar el modal de zoom al hacer click en el fondo o imagen
    if (imageZoomModal) {
        imageZoomModal.addEventListener('click', (e) => {
            if (e.target === imageZoomModal || e.target === zoomedImage) {
                imageZoomModal.classList.remove('show');
            }
        });
    }
    
    // Cerrar con la tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imageZoomModal && imageZoomModal.classList.contains('show')) {
            imageZoomModal.classList.remove('show');
        }
    });
}
