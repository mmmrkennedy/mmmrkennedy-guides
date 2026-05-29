/**
 * Page-level utility functions
 * Handles page identification.
 */

/** Gets the current page filename from the URL. */
function getCurrentPage(): string {
    return window.location.pathname.split("/").pop() ?? "";
}

// Make functions available globally
window.PageUtils = {
    getCurrentPage,
};
