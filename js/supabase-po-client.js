/**
 * ============================================================================
 * AKRA PO (PURCHASE ORDERS) SUPABASE API CLIENT
 * Supabase is the canonical Purchasing & Receiving store.
 * This browser client talks only to the authenticated PO Edge Function
 * and never holds a database credential.
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabasePO = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const API_URL = 'https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/po-api';

    async function request(action, data, token) {
        if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data: data || {}, token })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.message || payload.reason || `PO API HTTP ${response.status}`);
        }
        return payload;
    }

    return {
        getInitialData: async (options, token) => {
            return await request('getInitialData', options, token);
        },
        saveDirectPO: async (poData, token) => {
            return await request('saveDirectPO', poData, token);
        },
        deleteBill: async (payload, token) => {
            return await request('deleteBill', payload, token);
        }
    };
}));
