import { supabase, authReady } from '../supabase.js';

let suppliersData = [];
let isDemoMode = false;
let supabaseClient = null;

window.showModal = function(title, message, icon = '💡') {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-icon').innerText = icon;
    document.getElementById('notification-modal').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('notification-modal').classList.add('hidden');
}

window.openSupplierModal = function() {
    resetSupplierForm();
    document.getElementById('supplierModal').classList.remove('hidden');
}

window.closeSupplierModal = function() {
    document.getElementById('supplierModal').classList.add('hidden');
}

async function initApp() {
    try {
        await authReady;
        if (supabase) {
            supabaseClient = supabase;
            console.log("🔍 [SUPPLIER DEBUG] Supabase client initialized. Loading suppliers...");
            await loadSuppliersFromSupabase();
        } else {
            console.log("⚠️ [SUPPLIER DEBUG] Supabase not found. Running in Demo Mode.");
            isDemoMode = true;
            loadMockSuppliers();
        }
    } catch (err) {
        console.warn("⚠️ [SUPPLIER DEBUG] Init error, falling back to demo:", err);
        isDemoMode = true;
        loadMockSuppliers();
    }
}

async function loadSuppliersFromSupabase() {
    try {
        const { data, error } = await supabaseClient.from('suppliers').select('*').order('created_at', { ascending: false });
        if (error) {
            console.error("❌ [SUPPLIER DEBUG] Error fetching suppliers:", error);
            loadMockSuppliers();
            return;
        }
        if (data) {
            suppliersData = data;
            console.log("✅ [SUPPLIER DEBUG] Loaded Suppliers:", suppliersData.length);
            updateUI();
        }
    } catch (e) {
        console.error("❌ [SUPPLIER DEBUG] Exception fetching suppliers:", e);
        loadMockSuppliers();
    }
}

function loadMockSuppliers() {
    suppliersData = [
        { id: 'sup_1', name: 'Toko Daging Makmur', contact_person: 'Bpk. Hendra', phone: '08123456789', address: 'Jl. Pasar Baru No. 12', notes: 'Supplier ayam dan daging segar' },
        { id: 'sup_2', name: 'CV Berkah Tepung Sejahtera', contact_person: 'Ibu Siska', phone: '08987654321', address: 'Jl. Industri Raya No. 45', notes: 'Supplier tapioka dan maizena' }
    ];
    updateUI();
}

function updateUI() {
    const totalEl = document.getElementById('statTotalSuppliers');
    if (totalEl) totalEl.innerText = suppliersData.length;
    renderSuppliersTable();
}

window.renderSuppliersTable = function() {
    const searchInput = document.getElementById('supplierSearch');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const tbody = document.getElementById('suppliers-table-tbody');
    if (!tbody) return;

    const filtered = suppliersData.filter(s => 
        (s.name || '').toLowerCase().includes(query) || 
        (s.contact_person || '').toLowerCase().includes(query) ||
        (s.phone || '').includes(query)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Belum ada data supplier yang ditemukan.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(s => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-4 font-semibold text-slate-800">${escapeHtml(s.name)}</td>
            <td class="p-4 text-slate-600">${escapeHtml(s.contact_person || '-')}</td>
            <td class="p-4 text-slate-600"><a href="https://wa.me/${s.phone}" target="_blank" class="text-orange-600 hover:underline"><i class="fa-brands fa-whatsapp"></i> ${escapeHtml(s.phone || '-')}</a></td>
            <td class="p-4 text-slate-600">${escapeHtml(s.address || '-')}</td>
            <td class="p-4 text-slate-500 italic">${escapeHtml(s.notes || '-')}</td>
            <td class="p-4 text-right space-x-2">
                <button onclick="editSupplier('${s.id}')" class="text-orange-600 hover:text-orange-800 font-semibold px-2.5 py-1 bg-orange-50 rounded-lg">Edit</button>
                <button onclick="deleteSupplier('${s.id}')" class="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 rounded-lg">Hapus</button>
            </td>
        </tr>
    `).join('');
}

window.handleSupplierSubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('supplier-edit-id').value || 'sup_' + Date.now();
    const name = document.getElementById('sup-name').value;
    const contact_person = document.getElementById('sup-contact').value;
    const phone = document.getElementById('sup-phone').value;
    const address = document.getElementById('sup-address').value;
    const notes = document.getElementById('sup-notes').value;

    const payload = { id, name, contact_person, phone, address, notes };

    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('suppliers').upsert([payload]);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        await loadSuppliersFromSupabase();
    } else {
        const idx = suppliersData.findIndex(s => String(s.id) === String(id));
        if (idx >= 0) suppliersData[idx] = payload;
        else suppliersData.unshift(payload);
        updateUI();
    }

    closeSupplierModal();
    showModal("Sukses", "Data supplier berhasil disimpan!", "✅");
}

window.editSupplier = function(id) {
    const s = suppliersData.find(item => String(item.id) === String(id));
    if (!s) return;
    document.getElementById('supplier-edit-id').value = s.id;
    document.getElementById('sup-name').value = s.name || '';
    document.getElementById('sup-contact').value = s.contact_person || '';
    document.getElementById('sup-phone').value = s.phone || '';
    document.getElementById('sup-address').value = s.address || '';
    document.getElementById('sup-notes').value = s.notes || '';
    document.getElementById('supplierModalTitle').innerText = "Edit Master Supplier";
    document.getElementById('supplierModal').classList.remove('hidden');
}

window.resetSupplierForm = function() {
    const form = document.getElementById('supplierForm');
    if (form) form.reset();
    document.getElementById('supplier-edit-id').value = '';
    document.getElementById('supplierModalTitle').innerText = "Tambah Supplier Baru";
}

window.deleteSupplier = async function(id) {
    if (!confirm("Hapus data supplier ini?")) return;

    if (supabaseClient && !isDemoMode) {
        const { error } = await supabaseClient.from('suppliers').delete().eq('id', id);
        if (error) {
            showModal("Gagal", error.message, "❌");
            return;
        }
        await loadSuppliersFromSupabase();
    } else {
        suppliersData = suppliersData.filter(s => String(s.id) !== String(id));
        updateUI();
    }
    showModal("Terhapus", "Data supplier berhasil dihapus.", "🗑️");
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "\"").replace(/'/g, "'");
}

window.onload = function() {
    initApp();
};
