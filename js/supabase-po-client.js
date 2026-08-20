/**
 * ============================================================================
 * AKRA PO (PURCHASE ORDERS) SUPABASE API CLIENT
 * Status: DEACTIVATED / CONTAINED for Security Hardening (Plan 20260820-004)
 * Purchasing mutations and data access execute via authoritative backend (GAS).
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabasePO = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const SUPABASE_CONFIG = {
        URL: 'https://hgxrrskztbpejirrdpbq.supabase.co',
        KEY: ''
    };

    return {
        getProducts: async () => [],
        searchProducts: async () => [],
        getInitialData: async () => { throw new Error('Supabase PO client deactivated. Falling back to GAS.'); },
        saveDirectPO: async () => { throw new Error('Supabase PO client deactivated. Falling back to GAS.'); }
    };
}));
