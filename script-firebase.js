// Firebase Integration para Objetos Perdidos ITT (CDN SDK + firebase-config.js)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    query, 
    orderBy, 
    limit, 
    getDocs, 
    addDoc, 
    doc, 
    deleteDoc, 
    getCountFromServer, 
    enableNetwork 
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// Inicializar Firebase con configuraciones optimizadas
const app = initializeApp(window.firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

try {
    enableNetwork(db);
    console.log('Firebase inicializado correctamente.');
} catch (error) {
    console.warn('Configuración de red Firebase:', error);
}

// Variables de estado global
let allObjectsMetadata = []; // Lista ligera de todos los objetos para búsqueda y conteo rápido
let objectsCache = new Map(); // id -> objeto completo con imagen
let categoryCounts = {
    'electronico': 0,
    'ropa': 0,
    'cuadernos': 0,
    'otros': 0
};
let categoryPreviews = {
    'electronico': [],
    'ropa': [],
    'cuadernos': [],
    'otros': []
};
let totalObjectsCount = 0;
let currentPage = 1;
let itemsPerPage = 10;
let isMetadataLoaded = false;
let isFetchingBatch = false;
let currentRenderToken = 0;

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
const categoriesGrid = document.getElementById('categoriesGrid');

// Helper para parsear documentos REST de Firestore
function parseFirestoreDoc(rawDoc) {
    if (!rawDoc || !rawDoc.fields) return null;
    const fields = rawDoc.fields;
    const obj = { id: rawDoc.name.split('/').pop() };
    for (const [key, val] of Object.entries(fields)) {
        if ('stringValue' in val) obj[key] = val.stringValue;
        else if ('integerValue' in val) obj[key] = parseInt(val.integerValue, 10);
        else if ('timestampValue' in val) obj[key] = val.timestampValue;
        else if ('booleanValue' in val) obj[key] = val.booleanValue;
        else obj[key] = Object.values(val)[0];
    }
    return obj;
}

// Normalizar texto para búsquedas (sin acentos, minúsculas)
function normalizeText(text) {
    return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Subida alternativa a Imgur
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

// Subida alternativa a Cloudinary
async function uploadToCloudinary(file) {
    const cloudName = window.CLOUDINARY_CLOUD_NAME;
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary no configurado');
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

// Inicialización de la aplicación
function startRealtimeListener() {
    showLoadingIndicator();
    loadInitialData();
}

// Cargar datos iniciales
async function loadInitialData() {
    try {
        console.log('Iniciando carga optimizada de datos...');
        
        // 1. Cargar la primera página (primeros 10 objetos con imágenes) para render inmediato
        await loadInitialPage();
        
        // 2. En segundo plano: obtener total exacto, metadatos de todos los objetos y miniaturas de categorías
        loadTotalCount();
        loadAllMetadataAndCategories();
        
        // 3. Listener ligero para actualizaciones de nuevos objetos en tiempo real
        setupLightweightRealtimeListener();
        
    } catch (error) {
        console.error('Error en carga inicial:', error);
        hideLoadingIndicator();
        showError('No se pudieron cargar los objetos. Intenta recargar la página.');
    }
}

// Cargar la página 1 directamente con el SDK para velocidad inmediata
async function loadInitialPage() {
    try {
        const col = collection(db, 'lostObjects');
        const q = query(col, orderBy('addedAt', 'desc'), limit(itemsPerPage));
        const snapshot = await getDocs(q);
        
        const initialItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`Página 1 cargada: ${initialItems.length} objetos`);
        
        // Guardar en caché
        initialItems.forEach(item => {
            objectsCache.set(item.id, item);
        });
        
        // Inicializar metadatos provisionales con los 10 primeros mientras llega el resto
        if (allObjectsMetadata.length === 0) {
            allObjectsMetadata = initialItems.map(item => ({
                id: item.id,
                name: item.name,
                category: item.category,
                location: item.location,
                date: item.date,
                addedAt: item.addedAt,
                keywords: item.keywords,
                description: item.description
            }));
            
            // Conteo provisional de categorías
            initialItems.forEach(item => {
                const cat = item.category || 'otros';
                if (cat in categoryCounts) categoryCounts[cat]++;
                else categoryCounts.otros++;
                
                if (categoryPreviews[cat] && categoryPreviews[cat].length < 4 && item.image) {
                    categoryPreviews[cat].push(item);
                }
            });
        }
        
        hideLoadingIndicator();
        renderCategories();
        await renderCurrentPage();
        
    } catch (error) {
        console.warn('Error cargando página inicial con SDK:', error);
        throw error;
    }
}

// Obtener el conteo total exacto del servidor (rápido, sin descargar imágenes)
async function loadTotalCount() {
    try {
        const col = collection(db, 'lostObjects');
        const snapshot = await getCountFromServer(col);
        const total = snapshot.data().count;
        
        totalObjectsCount = total;
        if (totalObjetos) {
            totalObjetos.textContent = String(total);
        }
        updatePaginationControls();
    } catch (error) {
        console.warn('No se pudo obtener el total agregado:', error);
    }
}

// Cargar metadatos completos (solo ~260 KB) y miniaturas representativas por categoría
async function loadAllMetadataAndCategories() {
    const projectId = window.firebaseConfig?.projectId || 'objetos-perdidos-itt';
    const project = `projects/${projectId}/databases/(default)/documents`;
    const runQueryUrl = `https://firestore.googleapis.com/v1/${project}:runQuery`;
    
    try {
        // Consultar únicamente los metadatos de todos los documentos (sin el campo image para ultra velocidad)
        const res = await fetch(runQueryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: 'lostObjects' }],
                    select: {
                        fields: [
                            { fieldPath: 'name' },
                            { fieldPath: 'category' },
                            { fieldPath: 'date' },
                            { fieldPath: 'location' },
                            { fieldPath: 'addedAt' },
                            { fieldPath: 'keywords' },
                            { fieldPath: 'description' }
                        ]
                    },
                    orderBy: [{ field: { fieldPath: 'addedAt' }, direction: 'DESCENDING' }]
                }
            })
        });
        
        if (!res.ok) throw new Error(`HTTP ${res.status} al obtener metadatos`);
        
        const rawData = await res.json();
        const docs = rawData.filter(d => d.document).map(d => parseFirestoreDoc(d.document));
        
        console.log(`Metadatos de ${docs.length} objetos cargados en segundo plano.`);
        allObjectsMetadata = docs;
        isMetadataLoaded = true;
        totalObjectsCount = docs.length;
        
        if (totalObjetos) {
            totalObjetos.textContent = String(docs.length);
        }
        
        // Calcular conteos reales exactos para cada categoría
        const newCategoryCounts = {
            'electronico': 0,
            'ropa': 0,
            'cuadernos': 0,
            'otros': 0
        };
        
        allObjectsMetadata.forEach(item => {
            const cat = item.category || 'otros';
            if (cat in newCategoryCounts) {
                newCategoryCounts[cat]++;
            } else {
                newCategoryCounts.otros++;
            }
        });
        categoryCounts = newCategoryCounts;
        
        // Actualizar paginación con el total real
        updatePaginationControls();
        
        // Obtener hasta 4 objetos con imágenes para cada una de las 4 categorías
        await loadCategoryThumbnails(project);
        
        // Renderizar las categorías con sus imágenes y conteos exactos
        renderCategories();
        
    } catch (error) {
        console.warn('Error cargando metadatos o categorías:', error);
    }
}

// Cargar hasta 4 imágenes por categoría para el grid 2x2
async function loadCategoryThumbnails(project) {
    try {
        const categories = ['electronico', 'ropa', 'cuadernos', 'otros'];
        const previewIds = [];
        
        categories.forEach(catKey => {
            const catDocs = allObjectsMetadata.filter(d => d.category === catKey).slice(0, 4);
            catDocs.forEach(d => {
                if (!objectsCache.has(d.id) || !objectsCache.get(d.id).image) {
                    previewIds.push(d.id);
                }
            });
        });
        
        if (previewIds.length > 0) {
            await fetchMissingImages(previewIds);
        }
        
        // Asignar los objetos completos a las vistas previas de cada categoría
        categories.forEach(catKey => {
            const catDocs = allObjectsMetadata.filter(d => d.category === catKey).slice(0, 4);
            categoryPreviews[catKey] = catDocs.map(d => objectsCache.get(d.id) || d);
        });
        
    } catch (error) {
        console.warn('Error cargando miniaturas de categorías:', error);
    }
}

// Descargar en lote las imágenes faltantes en bloques progresivos con actualización en tiempo real
async function fetchMissingImages(ids, onImageLoaded) {
    if (!ids || ids.length === 0) return;
    
    // Evitar descargas duplicadas simultáneas
    const uniqueIds = Array.from(new Set(ids)).filter(id => !objectsCache.has(id) || !objectsCache.get(id).image);
    if (uniqueIds.length === 0) return;
    
    try {
        const projectId = window.firebaseConfig?.projectId || 'objetos-perdidos-itt';
        const project = `projects/${projectId}/databases/(default)/documents`;
        
        // Bloques de 10 objetos para que se muestren inmediatamente de arriba hacia abajo
        const chunkSize = 10;
        const chunks = [];
        for (let i = 0; i < uniqueIds.length; i += chunkSize) {
            chunks.push(uniqueIds.slice(i, i + chunkSize));
        }
        
        // Procesar con concurrencia de 2 bloques simultáneos para máxima velocidad
        for (let i = 0; i < chunks.length; i += 2) {
            const pair = chunks.slice(i, i + 2);
            await Promise.all(pair.map(async (chunk) => {
                try {
                    const res = await fetch(`https://firestore.googleapis.com/v1/${project}:batchGet`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            documents: chunk.map(id => `${project}/lostObjects/${id}`)
                        })
                    });
                    
                    if (!res.ok) return;
                    
                    const data = await res.json();
                    if (Array.isArray(data)) {
                        for (const item of data) {
                            if (item.found) {
                                const parsed = parseFirestoreDoc(item.found);
                                if (parsed) {
                                    const existing = objectsCache.get(parsed.id) || {};
                                    objectsCache.set(parsed.id, { ...existing, ...parsed });
                                    
                                    // Notificar inmediatamente en cuanto llega cada imagen
                                    if (typeof onImageLoaded === 'function' && parsed.image) {
                                        onImageLoaded(parsed.id, parsed.image);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Error en bloque batchGet:', e);
                }
            }));
        }
    } catch (error) {
        console.warn('Error en fetchMissingImages:', error);
    }
}

// Escuchar únicamente los últimos 5 objetos agregados para tiempo real ligero
function setupLightweightRealtimeListener() {
    try {
        const col = collection(db, 'lostObjects');
        const q = query(col, orderBy('addedAt', 'desc'), limit(5));
        
        onSnapshot(q, (snapshot) => {
            let hasNew = false;
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = { id: change.doc.id, ...change.doc.data() };
                    // Si no lo tenemos en metadatos, es un objeto recién registrado
                    if (!allObjectsMetadata.some(o => o.id === data.id)) {
                        allObjectsMetadata.unshift({
                            id: data.id,
                            name: data.name,
                            category: data.category,
                            location: data.location,
                            date: data.date,
                            addedAt: data.addedAt,
                            keywords: data.keywords,
                            description: data.description
                        });
                        objectsCache.set(data.id, data);
                        
                        const cat = data.category || 'otros';
                        if (cat in categoryCounts) categoryCounts[cat]++;
                        else categoryCounts.otros++;
                        
                        totalObjectsCount++;
                        hasNew = true;
                    }
                }
            });
            
            if (hasNew) {
                if (totalObjetos) totalObjetos.textContent = String(totalObjectsCount);
                renderCategories();
                if (currentPage === 1 && !searchInput?.value && !categoryFilter?.value) {
                    renderCurrentPage();
                } else {
                    updatePaginationControls();
                }
            }
        }, (error) => {
            console.warn('Realtime listener error:', error);
        });
    } catch (e) {
        console.warn('No se pudo inicializar listener en tiempo real:', e);
    }
}

// Obtener los objetos filtrados según el texto de búsqueda y la categoría seleccionada
function getFilteredObjects() {
    const searchTerm = normalizeText(searchInput ? searchInput.value : '');
    const selectedCategory = categoryFilter ? categoryFilter.value : '';

    const sourceList = (allObjectsMetadata.length > 0) 
        ? allObjectsMetadata 
        : Array.from(objectsCache.values());

    return sourceList.filter(obj => {
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
}

// Renderizar la página actual de objetos
async function renderCurrentPage() {
    const filtered = getFilteredObjects();
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    
    // Asegurar que la página actual sea válida
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageItems = filtered.slice(startIndex, endIndex);
    
    if (pageItems.length === 0) {
        if (objectsGrid) objectsGrid.style.display = 'none';
        if (noObjects) noObjects.style.display = 'block';
        const paginationControls = document.getElementById('paginationControls');
        if (paginationControls) paginationControls.style.display = 'none';
        return;
    }

    if (objectsGrid) objectsGrid.style.display = 'grid';
    if (noObjects) noObjects.style.display = 'none';

    // Token para asegurar que sólo actualizamos el DOM si el usuario no ha cambiado de página
    const renderToken = ++currentRenderToken;

    // Determinar si hay imágenes que aún no están en la memoria caché
    const missingIds = pageItems
        .filter(item => !objectsCache.has(item.id) || !objectsCache.get(item.id).image)
        .map(item => item.id);

    // 1. Renderizar tarjetas de inmediato con lo que ya tengamos en memoria (o placeholder)
    renderCards(pageItems);
    updatePaginationControls();

    // 2. Si faltan imágenes, descargarlas en streaming y mostrarlas en vivo en cuanto llegue cada una
    if (missingIds.length > 0) {
        fetchMissingImages(missingIds, (id, imageUrl) => {
            // Solo aplicar al DOM si seguimos en la misma página que inició la carga
            if (renderToken === currentRenderToken) {
                applyImageToCard(id, imageUrl);
            }
        });
    }
}

// Aplicar imagen a una tarjeta específica en tiempo real con transición suave
function applyImageToCard(id, imageUrl) {
    if (!objectsGrid || !imageUrl) return;
    const card = objectsGrid.querySelector(`[data-object-id="${id}"]`);
    if (!card) return;

    let img = card.querySelector('img');
    const noImg = card.querySelector('.no-image');

    if (img) {
        if (img.src !== imageUrl) {
            img.src = imageUrl;
        }
        img.style.display = 'block';
        img.style.opacity = '1';
        if (noImg) noImg.style.display = 'none';
    } else {
        img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'Objeto';
        img.loading = 'lazy';
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity 0.35s ease-in;';
        img.onerror = function() {
            this.style.display = 'none';
            if (noImg) noImg.style.display = 'flex';
        };
        img.onload = function() {
            this.style.opacity = '1';
            if (noImg) noImg.style.display = 'none';
        };
        card.insertBefore(img, card.firstChild);
    }
}

// Renderizar tarjetas individuales en el grid
function renderCards(pageItems) {
    if (!objectsGrid) return;

    objectsGrid.innerHTML = pageItems.map((item, index) => {
        const fullItem = objectsCache.get(item.id) || item;
        const imageUrl = fullItem.image;

        return `
            <div class="object-card" data-object-id="${item.id}" onclick="showObjectDetails('${item.id}')" style="opacity: 0; animation: fadeInUp 0.4s ease-out forwards;" data-index="${index}">
                ${imageUrl ? `
                    <img src="${imageUrl}" alt="${item.name || 'Objeto'}" loading="lazy" 
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" 
                         style="width: 100%; height: 100%; object-fit: cover; display: block;">
                ` : ''}
                <div class="no-image" style="display: ${imageUrl ? 'none' : 'flex'}; width: 100%; height: 100%; background: #f8f9fa; align-items: center; justify-content: center; color: #6c757d;">
                    <i class="fas fa-image" style="font-size: 2rem;"></i>
                </div>
            </div>
        `;
    }).join('') + `
        <style>
            @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(15px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
    `;
    
    // Escalonar la animación suave
    const cards = objectsGrid.querySelectorAll('.object-card');
    cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.05}s`;
    });
}

// Actualizar los controles de paginación
function updatePaginationControls() {
    const filtered = getFilteredObjects();
    const totalObjects = filtered.length;
    const totalPages = Math.ceil(totalObjects / itemsPerPage) || 1;
    const paginationControls = document.getElementById('paginationControls');
    
    if (!paginationControls) return;
    
    if (totalObjects === 0 || totalPages <= 1) {
        paginationControls.style.display = 'none';
        return;
    }
    
    paginationControls.style.display = 'flex';
    
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    if (prevBtn) prevBtn.disabled = (currentPage <= 1);
    if (nextBtn) nextBtn.disabled = (currentPage >= totalPages);
    
    generatePageNumbers(currentPage, totalPages);
}

// Generar números de página con elipsis inteligente
function generatePageNumbers(current, total) {
    const pageNumbersContainer = document.getElementById('pageNumbers');
    if (!pageNumbersContainer) return;
    
    let html = '';
    const pages = new Set();
    pages.add(1);
    pages.add(total);
    
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
        pages.add(i);
    }
    
    const sorted = Array.from(pages).sort((a, b) => a - b);
    let prev = 0;
    
    for (const p of sorted) {
        if (prev && p - prev > 1) {
            html += `<span class="page-ellipsis">...</span>`;
        }
        const isActive = (p === current) ? 'active' : '';
        html += `<button class="page-number ${isActive}" onclick="goToPage(${p})" ${isActive ? 'aria-current="page"' : ''}>${p}</button>`;
        prev = p;
    }
    
    pageNumbersContainer.innerHTML = html;
}

// Navegar a la página siguiente
async function goToNextPage() {
    const filtered = getFilteredObjects();
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage < totalPages) {
        currentPage++;
        scrollToObjectsSection(); // Scroll inmediato al presionar el botón
        await renderCurrentPage();
    }
}

// Navegar a la página anterior
async function goToPreviousPage() {
    if (currentPage > 1) {
        currentPage--;
        scrollToObjectsSection(); // Scroll inmediato al presionar el botón
        await renderCurrentPage();
    }
}

// Navegar a una página específica
async function goToPage(pageNumber) {
    const filtered = getFilteredObjects();
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (pageNumber >= 1 && pageNumber <= totalPages && pageNumber !== currentPage) {
        currentPage = pageNumber;
        scrollToObjectsSection(); // Scroll inmediato al presionar el número
        await renderCurrentPage();
    }
}

// Cambiar elementos por página (10, 20, 50, 100)
async function changeItemsPerPage() {
    const select = document.getElementById('itemsPerPageSelect');
    if (select) {
        itemsPerPage = parseInt(select.value, 10) || 10;
        currentPage = 1;
        scrollToObjectsSection(); // Scroll inmediato al cambiar
        await renderCurrentPage();
    }
}

function scrollToObjectsSection() {
    const section = document.getElementById('objetos');
    if (section) {
        const rect = section.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const targetY = Math.max(0, rect.top + scrollTop - 20);
        window.scrollTo({
            top: targetY,
            behavior: 'smooth'
        });
    }
}

// Renderizar las 4 tarjetas de categorías
function renderCategories() {
    if (!categoriesGrid) return;

    const categories = [
        { key: 'electronico', name: 'Electrónicos', icon: 'fas fa-laptop' },
        { key: 'ropa', name: 'Ropa y Accesorios', icon: 'fas fa-tshirt' },
        { key: 'cuadernos', name: 'Cuadernos y Materiales', icon: 'fas fa-book' },
        { key: 'otros', name: 'Otros', icon: 'fas fa-box' }
    ];

    categoriesGrid.innerHTML = categories.map(category => {
        const count = categoryCounts[category.key] || 0;
        const previews = categoryPreviews[category.key] || [];

        let imageGrid = '';
        for (let i = 0; i < 4; i++) {
            const obj = previews[i];
            const imgUrl = obj ? (obj.image || (objectsCache.get(obj.id)?.image)) : null;
            
            if (imgUrl) {
                imageGrid += `
                    <div class="category-image-item">
                        <img src="${imgUrl}" alt="${obj.name || category.name}">
                    </div>
                `;
            } else {
                imageGrid += `
                    <div class="category-image-item fallback">
                        <i class="${category.icon}"></i>
                    </div>
                `;
            }
        }

        return `
            <div class="category-card" onclick="filterByCategory('${category.key}')">
                <div class="category-image">
                    ${imageGrid}
                </div>
                <div class="category-info">
                    <div class="category-name">${category.name}</div>
                    <div class="category-count">${count} objetos</div>
                </div>
            </div>
        `;
    }).join('');
}

// Filtrar al hacer clic en una tarjeta de categoría
function filterByCategory(categoryKey) {
    if (categoryFilter) {
        categoryFilter.value = categoryKey;
    }
    currentPage = 1;
    renderCurrentPage();
    scrollToObjectsSection();
}

// Limpiar búsqueda y filtros
function clearSearch() {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    currentPage = 1;
    renderCurrentPage();
}

// Filtrar al escribir o seleccionar categoría
function filterObjects() {
    currentPage = 1;
    renderCurrentPage();
}

// Mostrar detalles de un objeto en modal
async function showObjectDetails(id) {
    let obj = objectsCache.get(id);
    if (!obj) {
        obj = allObjectsMetadata.find(o => o.id === id);
    }
    if (!obj) return;

    document.getElementById('detailTitle').textContent = obj.name || 'Sin título';
    document.getElementById('detailImage').src = obj.image || getDefaultImage(obj.category);
    document.getElementById('detailImage').alt = obj.name || 'Objeto';
    document.getElementById('detailCategory').textContent = getCategoryName(obj.category);
    document.getElementById('detailDescription').textContent = obj.description || 'Sin descripción';
    document.getElementById('detailLocation').textContent = obj.location || 'No especificado';
    document.getElementById('detailDate').textContent = formatDate(obj.date);

    document.getElementById('objectDetailsModal').style.display = 'block';

    // Si aún no tenemos la imagen de alta calidad, cargarla
    if (!obj.image) {
        await fetchMissingImages([id]);
        const updated = objectsCache.get(id);
        if (updated && updated.image) {
            const modalImg = document.getElementById('detailImage');
            if (modalImg && document.getElementById('objectDetailsModal').style.display === 'block') {
                modalImg.src = updated.image;
            }
        }
    }
}

// Eliminar objeto (admin)
async function deleteObject(id) {
    if (confirm('¿Estás seguro de que quieres eliminar este objeto?')) {
        try {
            await deleteDoc(doc(db, 'lostObjects', id));
            showNotification('Objeto eliminado exitosamente', 'success');
            
            // Actualizar estado local
            allObjectsMetadata = allObjectsMetadata.filter(o => o.id !== id);
            objectsCache.delete(id);
            totalObjectsCount = Math.max(0, totalObjectsCount - 1);
            if (totalObjetos) totalObjetos.textContent = String(totalObjectsCount);
            
            renderCategories();
            renderCurrentPage();
        } catch (error) {
            console.error('Error eliminando objeto:', error);
            showNotification('Error al eliminar el objeto', 'error');
        }
    }
}

// Agregar nuevo objeto
async function handleObjectSubmit(e) {
    e.preventDefault();
    
    const imageFile = document.getElementById('objectImageFile')?.files[0];
    let imageUrl = document.getElementById('objectImage')?.value || getDefaultImage(document.getElementById('objectCategory')?.value);
    
    if (imageFile) {
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
                    showNotification('No se pudo subir imagen. Usa una URL o configura Cloudinary/Imgur.', 'error');
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
        const docRef = await addDoc(collection(db, 'lostObjects'), newObject);
        showNotification('Objeto registrado exitosamente', 'success');
        objectForm.reset();
        
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('objectDate');
        if (dateInput) dateInput.value = today;
        
        // Agregar al inicio de los datos locales
        const createdObj = { id: docRef.id, ...newObject };
        allObjectsMetadata.unshift(createdObj);
        objectsCache.set(docRef.id, createdObj);
        totalObjectsCount++;
        
        const cat = createdObj.category || 'otros';
        if (cat in categoryCounts) categoryCounts[cat]++;
        else categoryCounts.otros++;
        
        if (totalObjetos) totalObjetos.textContent = String(totalObjectsCount);
        renderCategories();
        currentPage = 1;
        renderCurrentPage();
        
    } catch (error) {
        console.error('Error adding object:', error);
        showNotification('Error al registrar objeto', 'error');
    }
}

// Imágenes por defecto por categoría
function getDefaultImage(category) {
    const defaultImages = {
        'electronico': 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&h=300&fit=crop',
        'ropa': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=300&fit=crop',
        'cuadernos': 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=400&h=300&fit=crop',
        'otros': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=300&fit=crop'
    };
    return defaultImages[category] || defaultImages['otros'];
}

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
    if (!dateString || dateString.trim() === '') return 'Sin fecha';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function showLoadingIndicator() {
    if (objectsGrid) {
        objectsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid var(--primary-color, #007bff); border-radius: 50%; animation: spin 0.9s linear infinite;"></div>
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

function hideLoadingIndicator() {
    // Se reemplaza automáticamente al renderizar las tarjetas
}

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

function showNotification(message, type = 'info') {
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
        toast.style.transition = 'opacity 0.3s ease';
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

// Zoom de imagen
function setupImageZoom() {
    const imageZoomModal = document.getElementById('imageZoomModal');
    const zoomedImage = document.getElementById('zoomedImage');
    const imageZoomClose = document.querySelector('.image-zoom-close');
    
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'detailImage') {
            const imgSrc = e.target.src;
            if (imgSrc && imgSrc !== '') {
                zoomedImage.src = imgSrc;
                imageZoomModal.classList.add('show');
            }
        }
    });
    
    if (imageZoomClose) {
        imageZoomClose.addEventListener('click', (e) => {
            e.stopPropagation();
            imageZoomModal.classList.remove('show');
        });
    }
    
    if (imageZoomModal) {
        imageZoomModal.addEventListener('click', (e) => {
            if (e.target === imageZoomModal || e.target === zoomedImage) {
                imageZoomModal.classList.remove('show');
            }
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imageZoomModal && imageZoomModal.classList.contains('show')) {
            imageZoomModal.classList.remove('show');
        }
    });
}

// Configurar Event Listeners del DOM
function setupEventListeners() {
    if (objectForm) {
        objectForm.addEventListener('submit', handleObjectSubmit);
    }

    if (searchInput) {
        searchInput.addEventListener('input', filterObjects);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                filterObjects();
                scrollToObjectsSection();
            }
        });
    }

    if (categoryFilter) {
        categoryFilter.addEventListener('change', filterObjects);
    }

    const objectDetailsModal = document.getElementById('objectDetailsModal');
    const objectClose = document.querySelector('.object-close');
    
    if (objectClose && objectDetailsModal) {
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

    const objectDateInput = document.getElementById('objectDate');
    if (objectDateInput) {
        objectDateInput.value = new Date().toISOString().split('T')[0];
    }
}

// Evento inicial al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    setupImageZoom();
    startRealtimeListener();
});

// Scroll spy para la barra de navegación
window.addEventListener('scroll', function() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
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

// Exponer funciones necesarias globalmente para los atributos onclick/onchange del HTML
window.goToPreviousPage = goToPreviousPage;
window.goToNextPage = goToNextPage;
window.changeItemsPerPage = changeItemsPerPage;
window.goToPage = goToPage;
window.showObjectDetails = showObjectDetails;
window.filterByCategory = filterByCategory;
window.clearSearch = clearSearch;
window.deleteObject = deleteObject;
