// ============================================================
// Central brand & payment configuration for Apex Esports
// Edit this single file to rebrand the entire platform.
// ============================================================

/** Displayed name of the organization */
export const ORG_NAME = "Apex Esports";

/** Short tagline used in hero sections and meta tags */
export const ORG_TAGLINE = "Daily scrims, tournaments & leagues with real cash prizes";

/** UPI Virtual Payment Address — shown on QR and copy button */
export const UPI_ID = "sachingosain@fm";

/** Payee name that appears in UPI apps */
export const UPI_PAYEE_NAME = "Sachin Gosain";

/**
 * WhatsApp support number (with country code, no spaces or dashes).
 * Used for support deep-links: https://wa.me/<SUPPORT_WHATSAPP>
 */
export const SUPPORT_WHATSAPP = "919717057552";

/** Slot hold duration in seconds (must match Supabase create_order logic) */
export const SLOT_HOLD_SECONDS = 600; // 10 minutes
