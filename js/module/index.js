
import { supabase, authReady } from '../supabase.js';

const sampleProducts = [
    { id: 1, name: 'Dimsum Mentai Mix (4 Pcs)', category: 'dimsum', price: 22000, desc: 'Dimsum lembut dengan saus mentai gurih dibakar sempurna.', image: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=500&auto=format&fit=crop&q=60' },
    { id: 2, name: 'Dimsum Udang Keju (4 Pcs)', category: 'dimsum', price: 24000, desc: 'Dimsum udang segar dengan lelehan keju mozzarella di dalam.', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=500&auto=format&fit=crop&q=60' },
    { id: 3, name: 'Ayam Krispy Dada Spesial', category: 'chicken', price: 25000, desc: 'Dada ayam pilihan dilapisi tepung bumbu renyah gurih.', image: 'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?w=500&auto=format&fit=crop&q=60' },
    { id: 4, name: 'Ayam Krispy Paha Spicy', category: 'chicken', price: 23000, desc: 'Paha bawah juicy berbalut bumbu spicy pedas menggigit.', image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=500&auto=format&fit=crop&q=60' },
    { id: 5, name: 'Es Teh Manis Segar', category: 'drink', price: 5000, desc: 'Teh melati pilihan disajikan dingin menyegarkan.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500&auto=format&fit=crop&q=60' },
    { id: 6, name: 'Lemon Tea Dingin', category: 'drink', price: 8000, desc: 'Perpaduan teh segar dan perasan buah lemon asli.', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500&auto=format&fit=crop&q=60' }
];

window.products = [];
let cart = [];
let currentFilter = 'all';
let pendingOrderData = null;
const WA_TARGET_NUMBER = '6285723785380';

window.addEventListener('DOMContentLoaded', async () => {
    await loadProductsFromSupabase();
});

async function loadProductsFromSupabase() {
    await authReady;
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        if (data && data.length > 0) {
            window.products = data.map(p => ({
                id: p.id,
                name: p.nama || p.name,
                category: (p.kategori || p.category || 'umum').toLowerCase(),
                price: Number(p.harga || p.price || 0),
                desc: p.deskripsi || p.desc || '',
                image: p.foto || p.image || 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=500'
            }));
        } else {
            window.products = sampleProducts;
        }
    } catch (e) {
        console.warn('Fallback to sample products:', e);
        window.products = sampleProducts;
    }
    buildDynamicCategories();
    renderProducts(window.products);
}

function renderProducts(items) {
    const container = document.getElementById('product-grid-container');
    if (!container) return;

    if (currentFilter === 'all') {
        // Group by category when filter is 'all'
        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'umum';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        let groupedHTML = '';
        Object.keys(grouped).forEach(cat => {
            const displayName = cat.charAt(0).toUpperCase() + cat.slice(1);
            const catItems = grouped[cat];

            groupedHTML += `
                <div class="mb-10 last:mb-0">
                    <div class="flex items-center space-x-3 mb-5">
                        <h4 class="text-xl font-extrabold text-slate-900 tracking-tight">${displayName}</h4>
                        <div class="flex-grow h-px bg-slate-200"></div>
                        <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">${catItems.length} Pilihan</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            `;

            catItems.forEach(item => {
                groupedHTML += `
                    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition">
                        <div>
                            <div class="h-48 overflow-hidden relative">
                                <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover hover:scale-105 transition duration-300" onerror="this.src='https://placehold.co/500x300/ff6b35/ffffff?text=ChimChum'">
                                <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-slate-800 text-xs font-semibold px-2.5 py-1 rounded-lg uppercase">${item.category}</span>
                            </div>
                            <div class="p-5">
                                <h4 class="font-bold text-slate-900 mb-1">${item.name}</h4>
                                <p class="text-xs text-slate-500 line-clamp-2 mb-4">${item.desc}</p>
                            </div>
                        </div>
                        <div class="p-5 pt-0 flex items-center justify-between">
                            <span class="font-bold text-brand-600">Rp ${item.price.toLocaleString('id-ID')}</span>
                            <button onclick="addToCart('${item.id}')" class="bg-brand-50 hover:bg-brand-500 text-brand-600 hover:text-white px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center space-x-1.5">
                                <i class="fa-solid fa-plus"></i>
                                <span>Tambah</span>
                            </button>
                        </div>
                    </div>
                `;
            });

            groupedHTML += `
                    </div>
                </div>
            `;
        });

        container.innerHTML = groupedHTML;
    } else {
        // Flat grid for specific category filter
        let gridHTML = `<div id="product-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">`;
        items.forEach(item => {
            gridHTML += `
                <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition">
                    <div>
                        <div class="h-48 overflow-hidden relative">
                            <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover hover:scale-105 transition duration-300" onerror="this.src='https://placehold.co/500x300/ff6b35/ffffff?text=ChimChum'">
                            <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-slate-800 text-xs font-semibold px-2.5 py-1 rounded-lg uppercase">${item.category}</span>
                        </div>
                        <div class="p-5">
                            <h4 class="font-bold text-slate-900 mb-1">${item.name}</h4>
                            <p class="text-xs text-slate-500 line-clamp-2 mb-4">${item.desc}</p>
                        </div>
                    </div>
                    <div class="p-5 pt-0 flex items-center justify-between">
                        <span class="font-bold text-brand-600">Rp ${item.price.toLocaleString('id-ID')}</span>
                        <button onclick="addToCart('${item.id}')" class="bg-brand-50 hover:bg-brand-500 text-brand-600 hover:text-white px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center space-x-1.5">
                            <i class="fa-solid fa-plus"></i>
                            <span>Tambah</span>
                        </button>
                    </div>
                </div>
            `;
        });
        gridHTML += `</div>`;
        container.innerHTML = gridHTML;
    }
}

window.filterCategory = function(category) {
    currentFilter = category;
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.className = 'category-btn bg-white hover:bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 transition whitespace-nowrap';
    });
    const activeBtn = document.getElementById(`cat-${category}`);
    if (activeBtn) {
        activeBtn.className = 'category-btn bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition whitespace-nowrap';
    }
    if (category === 'all') {
        renderProducts(window.products);
    } else {
        renderProducts(window.products.filter(p => p.category === category));
    }
};

window.addToCart = function(productId) {
    const product = window.products.find(p => String(p.id) === String(productId));
    if (!product) return;
    const existing = cart.find(item => String(item.id) === String(productId));
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ ...product, qty: 1 });
    }
    updateCartUI();
};

window.updateCartQty = function(productId, change) {
    const item = cart.find(i => String(i.id) === String(productId));
    if (item) {
        item.qty += change;
        if (item.qty <= 0) {
            cart = cart.filter(i => String(i.id) !== String(productId));
        }
    }
    updateCartUI();
};

function updateCartUI() {
    const container = document.getElementById('cart-items-container');
    const badge = document.getElementById('cart-badge');
    const subtotalEl = document.getElementById('cart-subtotal');
    const totalEl = document.getElementById('cart-total');

    const totalQty = cart.reduce((sum, i) => sum + i.qty, 0);
    badge.innerText = totalQty;

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                <i class="fa-solid fa-basket-shopping text-2xl mb-1.5"></i>
                <p class="text-[11px]">Keranjang Anda masih kosong</p>
            </div>
        `;
        subtotalEl.innerText = 'Rp 0';
        totalEl.innerText = 'Rp 0';
        return;
    }

    container.innerHTML = '';
    let subtotal = 0;
    cart.forEach(item => {
        subtotal += item.price * item.qty;
        container.innerHTML += `
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                <div class="flex-grow pr-2">
                    <h5 class="font-semibold text-[11px] text-slate-900 leading-snug">${item.name}</h5>
                    <p class="text-[10px] text-brand-600 font-medium">Rp ${item.price.toLocaleString('id-ID')}</p>
                </div>
                <div class="flex items-center space-x-1 flex-shrink-0">
                    <button onclick="updateCartQty('${item.id}', -1)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-[9px]"><i class="fa-solid fa-minus"></i></button>
                    <span class="text-[11px] font-semibold w-4 text-center">${item.qty}</span>
                    <button onclick="updateCartQty('${item.id}', 1)" class="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-[9px]"><i class="fa-solid fa-plus"></i></button>
                </div>
            </div>
        `;
    });

    subtotalEl.innerText = `Rp ${subtotal.toLocaleString('id-ID')}`;
    totalEl.innerText = `Rp ${(subtotal + 5000).toLocaleString('id-ID')}`;
}

window.proceedToPayment = function() {
    if (cart.length === 0) {
        showNotification('Perhatian', 'Keranjang belanja masih kosong.', 'warning');
        return;
    }
    const name = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('customer-phone').value.trim();
    const address = document.getElementById('customer-address').value.trim();
    const paymentMethod = document.querySelector('input[name="payment_method"]:checked')?.value || 'QRIS';

    if (!name || !phone || !address) {
        showNotification('Perhatian', 'Harap lengkapi nama, nomor telepon, dan alamat.', 'warning');
        return;
    }

    // const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const now = new Date();

    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    
    const orderId = `ORD-${yy}${mm}${dd}${hh}${min}${ss}-${randomNum}`;
    const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    const grandTotal = subtotal + 5000;

    const jakartaOffset = 7 * 60;
    const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + jakartaOffset) * 60000);
    const jakartaISOString = localTime.toISOString().replace('Z', '+07:00');

    pendingOrderData = {
        order_id: orderId,
        customer_name: name,
        phone: phone,
        address: address,
        items: cart,
        grand_total: grandTotal,
        payment_method: paymentMethod,
        status: 'new',
        created_at: jakartaISOString
    };

    const instructionBox = document.getElementById('payment-instruction-box');
    const proofContainer = document.getElementById('payment-proof-container');

    if (paymentMethod === 'QRIS') {
        if (proofContainer) proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900 mb-1">Scan QRIS untuk Pembayaran:</p>
            <p class="text-slate-600 mb-2">Total: <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span></p>
            <div class="bg-white p-3 rounded-xl border border-slate-200 text-center">
                <img src="./assets/ChimChum-QRISSHOPEE.png" alt="QRIS Code" class="mx-auto w-32 h-32 object-contain" onerror="this.src='https://placehold.co/150?text=QRIS+ChimChum'">
            </div>
        `;
    } else if (paymentMethod === 'Transfer') {
        if (proofContainer) proofContainer.style.display = 'block';
        instructionBox.innerHTML = `
            <div class="flex items-center space-x-2.5 mb-2 pb-2 border-b border-slate-200">
                <div class="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 flex-shrink-0">
                    <i class="fa-solid fa-building-columns"></i>
                </div>
                <div>
                    <p class="font-bold text-slate-900 text-xs">Transfer Bank BCA Syariah</p>
                    <p class="text-[10px] text-slate-500">Silakan transfer sesuai nominal tagihan</p>
                </div>
            </div>
            <p class="text-slate-600">Nama Bank : <span class="font-bold text-slate-900">BCA Syariah</span></p>
            <p class="text-slate-600">No. Rekening : <span class="font-bold text-slate-900">8881798766</span></p>
            <p class="text-slate-600">Atas Nama : <span class="font-bold text-slate-900">Intan Dwi A I</span></p>
            <p class="text-slate-600 mt-1">Total Tagihan : <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span></p>
        `;
    } else {
        if (proofContainer) proofContainer.style.display = 'none';
        instructionBox.innerHTML = `
            <p class="font-bold text-slate-900 mb-1">Pembayaran Cash / COD:</p>
            <p class="text-slate-600">Silakan siapkan uang pas sebesar <span class="font-bold text-brand-600">Rp ${grandTotal.toLocaleString('id-ID')}</span> saat kurir tiba.</p>
        `;
    }

    toggleCartModal();
    document.getElementById('payment-modal').classList.remove('hidden');
};

window.closePaymentModal = function() {
    document.getElementById('payment-modal').classList.add('hidden');
};

window.confirmAndSubmitOrder = async function() {
    const fileInput = document.getElementById('payment-proof-file');
    const paymentMethod = pendingOrderData.payment_method;

    if (paymentMethod !== 'Cash' && (!fileInput.files || fileInput.files.length === 0)) {
        showNotification('Bukti Diperlukan', 'Harap upload bukti pembayaran terlebih dahulu.', 'warning');
        return;
    }

    let proofReference = 'Pending / Cash';

    try {
        await authReady;
        if (fileInput.files && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${pendingOrderData.order_id}_${Date.now()}.${fileExt}`;

            const reader = new FileReader();
            proofReference = await new Promise((resolve, reject) => {
                reader.onload = async (e) => {
                    const base64Data = e.target.result;
                    try {
                        const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('payment-proofs')
                            .upload(fileName, file, { cacheControl: '3600', upsert: true });

                        if (!uploadError) {
                            const { data: publicUrlData } = supabase.storage
                                .from('payment-proofs')
                                .getPublicUrl(fileName);
                            if (publicUrlData && publicUrlData.publicUrl) {
                                resolve(publicUrlData.publicUrl);
                                return;
                            }
                        }
                        resolve(base64Data);
                    } catch (err) {
                        resolve(base64Data);
                    }
                };
                reader.onerror = (err) => reject(err);
                reader.readAsDataURL(file);
            });
        }
    } catch (storageErr) {
        console.warn("Storage warning, using base64 reference:", storageErr);
    }

    pendingOrderData.payment_proof = proofReference;

    try {
        await authReady;
        await supabase.from('orders').insert([pendingOrderData]);
    } catch (dbErr) {
        console.error('Database exception:', dbErr);
    }

    let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
    localOrders.push(pendingOrderData);
    localStorage.setItem('local_orders', JSON.stringify(localOrders));

    const itemsListStr = pendingOrderData.items.map(i => `• ${i.name} (${i.qty}x) - Rp ${(i.price * i.qty).toLocaleString('id-ID')}`).join('\n');
    const trackingLink = `https://chimchummlg.vercel.app/lacak.html/${pendingOrderData.order_id}`;
    const waText = encodeURIComponent(
`*INVOICE PEMESANAN CHIMCHUM MALANG*
ID Pesanan: ${pendingOrderData.order_id}

*Detail Item:*
${itemsListStr}
────────────────
Subtotal: Rp ${(pendingOrderData.grand_total - 5000).toLocaleString('id-ID')}
*Total: Rp ${pendingOrderData.grand_total.toLocaleString('id-ID')}*

*Data Pemesan:*
Nama: ${pendingOrderData.customer_name}
No. WA: ${pendingOrderData.phone}
Alamat: ${pendingOrderData.address}
Pembayaran: ${pendingOrderData.payment_method}
Bukti Pembayaran: ${trackingLink}

Mohon segera diproses ya Kak, terima kasih! 🙏`
    );

    closePaymentModal();
    cart = [];
    updateCartUI();
    fileInput.value = '';

    showNotification('Pesanan Berhasil Dibuat!', `ID Pesanan: ${pendingOrderData.order_id}. Mengalihkan ke WhatsApp...`, 'success');
    
    setTimeout(() => {
        window.open(`https://wa.me/${WA_TARGET_NUMBER}?text=${waText}`, '_blank');
    }, 1200);
};

window.fetchOrderStatus = async function() {
    const orderId = document.getElementById('tracker-order-id').value.trim();
    const resultDiv = document.getElementById('tracker-result');
    if (!orderId) {
        showNotification('Perhatian', 'Masukkan ID pesanan terlebih dahulu.', 'warning');
        return;
    }

    let foundOrder = null;
    try {
        await authReady;
        const { data } = await supabase.from('orders').select('*').eq('order_id', orderId).maybeSingle();
        if (data) foundOrder = data;
    } catch (e) {
        console.error(e);
    }

    if (!foundOrder) {
        let localOrders = JSON.parse(localStorage.getItem('local_orders') || '[]');
        foundOrder = localOrders.find(o => o.order_id === orderId);
    }

    resultDiv.classList.remove('hidden');
    if (foundOrder) {
        let proofDisplay = '';
        if (foundOrder.payment_proof && foundOrder.payment_proof !== 'Pending / Cash') {
            if (foundOrder.payment_proof.startsWith('data:image')) {
                proofDisplay = `<div class="pt-2"><p class="text-xs text-slate-500 mb-1 font-semibold">Bukti Pembayaran:</p><img src="${foundOrder.payment_proof}" class="w-32 h-32 object-cover rounded-xl border border-slate-200"></div>`;
            } else {
                proofDisplay = `<div class="pt-2"><a href="${foundOrder.payment_proof}" target="_blank" class="text-xs text-brand-600 underline font-semibold">Lihat Bukti Pembayaran ↗</a></div>`;
            }
        }

        resultDiv.innerHTML = `
            <div class="bg-slate-50 p-4 rounded-2xl space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-slate-500">ID Pesanan:</span><span class="font-bold">${foundOrder.order_id}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Nama Pemesan:</span><span class="font-semibold">${foundOrder.customer_name}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Total Harga:</span><span class="font-bold text-brand-600">Rp ${Number(foundOrder.grand_total || foundOrder.total_price || 0).toLocaleString('id-ID')}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">Status:</span><span class="bg-amber-100 text-amber-700 text-xs px-2.5 py-1 rounded-full font-bold uppercase">${foundOrder.status}</span></div>
                ${proofDisplay}
            </div>
        `;
    } else {
        resultDiv.innerHTML = `
            <div class="text-center py-4 text-slate-400 text-sm">
                Pesanan dengan ID tersebut tidak ditemukan.
            </div>
        `;
    }
};

window.toggleCartModal = function() {
    document.getElementById('cart-modal').classList.toggle('hidden');
};

window.openTrackerModal = function() {
    document.getElementById('tracker-modal').classList.toggle('hidden');
};

window.showNotification = function(title, message, type = 'success') {
    const modal = document.getElementById('notification-modal');
    document.getElementById('notification-title').innerText = title;
    document.getElementById('notification-message').innerText = message;
    const iconContainer = document.getElementById('notification-icon');
    if (type === 'success') {
        iconContainer.className = 'w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        iconContainer.innerHTML = '<i class="fa-solid fa-check"></i>';
    } else {
        iconContainer.className = 'w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center text-2xl mx-auto';
        iconContainer.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }
    modal.classList.remove('hidden');
};

window.closeNotification = function() {
    document.getElementById('notification-modal').classList.add('hidden');
};
