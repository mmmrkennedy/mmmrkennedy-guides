/**
 * Lightbox system for images and videos
 * Handles media display, navigation, and keyboard controls
 */

let allTriggers = [];
let currentIndex = -1;
const preloadedUrls = new Set();

// Open/close fade duration; must match the .lightbox transition in layout.css
const FADE_MS = 200;

// Touch gesture state (mobile pinch-zoom / pan / swipe). Desktop keeps the
// mouse click-to-zoom path below; these are only driven by touch/pen pointers.
const imgTransform = { scale: 1, tx: 0, ty: 0 };
const activePointers = new Map();
let gestureWasPinch = false;
let pinchStart = null; // { dist, s0, P0x, P0y }
let panLast = null; // { x, y }
let swipeStart = null; // { x, y }
let lastTapTime = 0;
let lastPointerType = "mouse";
let navPrevBtn = null;
let navNextBtn = null;
let fittedSize = null; // saved fitted {width, height} to restore after desktop zoom-out
let lastFocused = null; // element focused before opening, restored on close

/** Returns the currently visible, focusable controls inside the lightbox (DOM order). */
function getFocusableElements() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return [];
    const candidates = lightbox.querySelectorAll("button:not([disabled]), video[controls]");
    return Array.from(candidates).filter((el) => el.offsetParent !== null);
}

/** Applies the current pan/zoom transform to the lightbox image. */
function applyImageTransform() {
    const img = document.getElementById("lightbox-img");
    if (img) {
        img.style.transform = `translate(${imgTransform.tx}px, ${imgTransform.ty}px) scale(${imgTransform.scale})`;
    }
}

/** Resets pan/zoom back to the fitted, centered state. */
function resetImageTransform() {
    imgTransform.scale = 1;
    imgTransform.tx = 0;
    imgTransform.ty = 0;
    const img = document.getElementById("lightbox-img");
    if (img) img.style.transform = "";
}

/** Keeps a zoomed image from being panned past its own edges. */
function clampTranslation() {
    const lightbox = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    if (!lightbox || !img) return;
    const maxX = Math.max(0, (img.offsetWidth * imgTransform.scale - lightbox.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * imgTransform.scale - lightbox.clientHeight) / 2);
    imgTransform.tx = Math.min(maxX, Math.max(-maxX, imgTransform.tx));
    imgTransform.ty = Math.min(maxY, Math.max(-maxY, imgTransform.ty));
}

/** Shows/hides and enables/disables the prev/next arrows for the current item. */
function updateNavButtons() {
    if (!navPrevBtn || !navNextBtn) return;
    const multiple = allTriggers.length > 1;
    navPrevBtn.style.display = multiple ? "flex" : "none";
    navNextBtn.style.display = multiple ? "flex" : "none";
    navPrevBtn.disabled = currentIndex <= 0;
    navNextBtn.disabled = currentIndex >= allTriggers.length - 1;
}

/**
 * Desktop (mouse) click-to-zoom: enlarge the image to its natural pixel size
 * and scroll so the clicked point is centered. Replaces the old 300vw/vh blow-up.
 */
function zoomInDesktop(lightbox, img, event) {
    if (!img.naturalWidth) return;

    // Clicked point as a fraction of the current fitted image
    const rect = img.getBoundingClientRect();
    const pctX = (event.clientX - rect.left) / rect.width;
    const pctY = (event.clientY - rect.top) / rect.height;

    // Remember the fitted size so zoom-out can restore it (may be "" for large images)
    fittedSize = { width: img.style.width, height: img.style.height };

    img.style.width = img.naturalWidth + "px";
    img.style.height = img.naturalHeight + "px";
    lightbox.classList.add("zoomed");

    requestAnimationFrame(() => {
        const scrollX = pctX * img.offsetWidth - lightbox.clientWidth / 2;
        const scrollY = pctY * img.offsetHeight - lightbox.clientHeight / 2;
        lightbox.scrollLeft = Math.max(0, scrollX);
        lightbox.scrollTop = Math.max(0, scrollY);
    });
}

/** Desktop zoom-out: restore the fitted size and reset scroll. */
function zoomOutDesktop(lightbox, img) {
    lightbox.classList.remove("zoomed");
    img.style.width = fittedSize ? fittedSize.width : "";
    img.style.height = fittedSize ? fittedSize.height : "";
    lightbox.scrollLeft = 0;
    lightbox.scrollTop = 0;
}

/**
 * Preloads adjacent media for faster navigation
 * @param {number} currentIndex - Index of the current media item
 */
function preloadAdjacentMedia(currentIndex) {
    if (!allTriggers.length) return;

    const toPreload = [];
    if (currentIndex > 0) toPreload.push(allTriggers[currentIndex - 1]);
    if (currentIndex < allTriggers.length - 1) toPreload.push(allTriggers[currentIndex + 1]);

    toPreload.forEach((trigger) => {
        if (trigger.dataset.mediaType === "image" && !preloadedUrls.has(trigger.href)) {
            preloadedUrls.add(trigger.href);
            new Image().src = trigger.href;
        }
    });
}

/**
 * Opens the lightbox with the specified media source
 * @param {string} mediaSrc - Source URL of the media
 * @param {string} captionText - Text to display as caption
 * @param {number} index - Index of the current media item
 * @param {string} mediaType - Type of media ('image' or 'video')
 */
function openLightbox(mediaSrc, captionText, index, mediaType) {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxVideo = document.getElementById("lightbox-video");
    const lightboxCaption = document.querySelector(".lightbox-caption");

    if (!lightbox || !lightboxImg || !lightboxVideo || !lightboxCaption) return;

    // Remember what to return focus to — only on the initial open, not while
    // navigating between items (where focus is already inside the dialog).
    const wasOpen = lightbox.classList.contains("is-open");
    if (!wasOpen && document.activeElement instanceof HTMLElement) {
        lastFocused = document.activeElement;
    }

    // Update current index
    currentIndex = index;

    // Reset zoom state for each new image
    lightbox.classList.remove("zoomed");
    resetImageTransform();
    updateNavButtons();

    // Show a loading state (the .is-open class drives the fade/scale-in)
    lightbox.style.display = "flex";
    requestAnimationFrame(() => lightbox.classList.add("is-open"));
    if (!wasOpen) {
        // Move focus into the dialog so keyboard/AT users land on the controls
        const closeBtn = lightbox.querySelector(".close-lightbox");
        if (closeBtn) requestAnimationFrame(() => closeBtn.focus());
    }
    lightboxImg.style.display = "none";
    lightboxVideo.style.display = "none";
    lightboxCaption.textContent = "Loading...";

    if (mediaType === "image") {
        // Handle image content
        const img = new Image();
        img.src = mediaSrc;
        img.onload = function () {
            // Set the source and display the image
            lightboxImg.setAttribute("src", mediaSrc);

            // Upscale small images so they don't render tiny in the lightbox.
            // Threshold: natural dims both under 600px. Scale to fit ~80vh / 90vw, capped at 3x.
            lightboxImg.style.width = "";
            lightboxImg.style.height = "";
            const SMALL_THRESHOLD = 600;
            const MAX_SCALE = 3;
            if (img.naturalWidth < SMALL_THRESHOLD && img.naturalHeight < SMALL_THRESHOLD) {
                const scale = Math.min(
                    MAX_SCALE,
                    (window.innerHeight * 0.8) / img.naturalHeight,
                    (window.innerWidth * 0.9) / img.naturalWidth
                );
                if (scale > 1) {
                    lightboxImg.style.width = img.naturalWidth * scale + "px";
                    lightboxImg.style.height = img.naturalHeight * scale + "px";
                }
            }

            lightboxImg.style.display = "block";
            lightboxCaption.textContent = captionText;

            // Preload adjacent media
            preloadAdjacentMedia(currentIndex);
        };

        img.onerror = function () {
            // Handle error case
            lightboxCaption.textContent = "Error loading image";
            lightboxImg.style.display = "none";
        };
    } else if (mediaType === "video") {
        // Handle video content
        lightboxVideo.setAttribute("src", mediaSrc);
        lightboxVideo.style.display = "block";
        lightboxCaption.textContent = captionText;

        // Set up event listeners for video loading
        lightboxVideo.onloadeddata = function () {
            // Video is loaded and can be played
            lightboxCaption.textContent = captionText;
        };

        lightboxVideo.onerror = function () {
            // Handle error case
            lightboxCaption.textContent = "Error loading video";
            lightboxVideo.style.display = "none";
        };

        // Start playing the video
        lightboxVideo.play().catch((e) => {
            console.warn("Auto-play prevented:", e);
            // This is expected on many browsers due to autoplay policies
        });
    }
}

/**
 * Navigates to the previous media item
 */
function navigateToPrevious() {
    if (currentIndex > 0) {
        const prevTrigger = allTriggers[currentIndex - 1];
        const mediaSrc = prevTrigger.href;
        let captionText = prevTrigger.dataset.caption || prevTrigger.textContent || "Media";
        captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
        const mediaType = prevTrigger.dataset.mediaType;
        openLightbox(mediaSrc, captionText, currentIndex - 1, mediaType);
    }
}

/**
 * Navigates to the next media item
 */
function navigateToNext() {
    if (currentIndex < allTriggers.length - 1) {
        const nextTrigger = allTriggers[currentIndex + 1];
        const mediaSrc = nextTrigger.href;
        let captionText = nextTrigger.dataset.caption || nextTrigger.textContent || "Media";
        captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
        const mediaType = nextTrigger.dataset.mediaType;
        openLightbox(mediaSrc, captionText, currentIndex + 1, mediaType);
    }
}

/**
 * Closes the lightbox and stops any playing videos
 */
function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    const lightboxVideo = document.getElementById("lightbox-video");

    if (lightbox) {
        // Fade out, then hide once the transition has run. The guard lets a
        // re-open during the fade cancel the pending hide.
        lightbox.classList.remove("is-open");
        lightbox.classList.remove("zoomed");
        window.setTimeout(() => {
            if (!lightbox.classList.contains("is-open")) lightbox.style.display = "none";
        }, FADE_MS);
    }

    resetImageTransform();

    if (lightboxVideo) {
        lightboxVideo.pause();
        lightboxVideo.currentTime = 0;
    }

    // Return focus to whatever opened the lightbox
    if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
    }
    lastFocused = null;

    // Reset current index
    currentIndex = -1;
}

/**
 * Handles lightbox trigger click events
 */
function handleLightboxClick() {
    const mediaSrc = this.href;
    let captionText = this.dataset.caption || this.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    const mediaType = this.dataset.mediaType;
    const index = allTriggers.indexOf(this);
    openLightbox(mediaSrc, captionText, index, mediaType);
}

/**
 * Initializes the lightbox by setting up event listeners.
 * Uses event delegation so dynamically rendered links (e.g. React solvers)
 * are handled without needing a re-init after mount.
 */
function initLightbox() {
    const lightbox = document.getElementById("lightbox");
    const closeBtn = document.querySelector(".close-lightbox");

    if (!lightbox || !closeBtn) {
        console.warn("Lightbox elements not found");
        return;
    }

    // Add close button event listener
    closeBtn.addEventListener("click", closeLightbox);

    // Add lightbox background click listener
    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) {
            closeLightbox();
        }
    });

    // Click-to-zoom on the lightbox image
    const lightboxImg = document.getElementById("lightbox-img");
    if (lightboxImg) {
        lightboxImg.addEventListener("click", (event) => {
            event.stopPropagation();

            // Touch/pen taps are handled by the gesture controller (double-tap zoom).
            if (lastPointerType === "touch" || lastPointerType === "pen") return;

            if (!lightbox.classList.contains("zoomed")) {
                zoomInDesktop(lightbox, lightboxImg, event);
            } else {
                zoomOutDesktop(lightbox, lightboxImg);
            }
        });
    }

    // Delegated click handler — catches both static and dynamically rendered media links
    document.addEventListener("click", (event) => {
        const anchor = event.target.closest("a");
        if (!anchor) return;

        const href = anchor.getAttribute("href");
        if (!href) return;

        const mediaExtensions = [".webp", ".jpg", ".jpeg", ".png", ".gif", ".webm", ".mp4", ".mov"];
        const isMedia = mediaExtensions.some((ext) => href.toLowerCase().endsWith(ext));
        if (!isMedia) return;

        event.preventDefault();

        // Ensure the anchor has the lightbox-trigger class and media type set
        if (!anchor.classList.contains("lightbox-trigger")) {
            anchor.classList.add("lightbox-trigger");
            const isVideo = [".webm", ".mp4", ".mov"].some((ext) => href.toLowerCase().endsWith(ext));
            anchor.dataset.mediaType = isVideo ? "video" : "image";
        }

        // Rebuild trigger list to include any links added after initial page load
        allTriggers = Array.from(document.querySelectorAll(".lightbox-trigger"));

        handleLightboxClick.call(anchor);
    });

    // Wire up the on-screen navigation arrows
    navPrevBtn = document.querySelector(".lightbox-prev");
    navNextBtn = document.querySelector(".lightbox-next");
    if (navPrevBtn) {
        navPrevBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            navigateToPrevious();
        });
    }
    if (navNextBtn) {
        navNextBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            navigateToNext();
        });
    }

    // Touch gestures (pinch-zoom, double-tap, pan, swipe) on the image
    if (lightboxImg) setupGestures(lightbox, lightboxImg);

    // Add keyboard event listeners
    document.addEventListener("keydown", (event) => {
        if (lightbox.classList.contains("is-open")) {
            if (event.key === "Escape") {
                closeLightbox();
            } else if (event.key === "ArrowLeft") {
                navigateToPrevious();
            } else if (event.key === "ArrowRight") {
                navigateToNext();
            } else if (event.key === "Tab") {
                // Trap focus within the dialog
                const focusables = getFocusableElements();
                if (!focusables.length) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (!lightbox.contains(document.activeElement)) {
                    first.focus();
                    event.preventDefault();
                } else if (event.shiftKey && document.activeElement === first) {
                    last.focus();
                    event.preventDefault();
                } else if (!event.shiftKey && document.activeElement === last) {
                    first.focus();
                    event.preventDefault();
                }
            }
        }
    });
}

/**
 * Sets up touch-driven pinch-zoom, double-tap zoom, drag-to-pan, and swipe
 * navigation/close on the lightbox image. Mouse pointers are ignored here so
 * the desktop click-to-zoom behaviour is preserved.
 * @param {HTMLElement} lightbox - The lightbox container
 * @param {HTMLImageElement} img - The lightbox image element
 */
function setupGestures(lightbox, img) {
    const SWIPE_THRESHOLD = 50; // px before a drag counts as a swipe
    const TAP_MOVE_TOL = 12; // px of movement still treated as a tap
    const DOUBLE_TAP_MS = 300;
    const MAX_SCALE = 4;
    const DOUBLE_TAP_SCALE = 2.5;

    const center = () => ({ cx: lightbox.clientWidth / 2, cy: lightbox.clientHeight / 2 });
    const focal = (event) => {
        const rect = lightbox.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    img.addEventListener("pointerdown", (event) => {
        lastPointerType = event.pointerType;
        if (event.pointerType === "mouse") return; // desktop uses click-to-zoom
        event.preventDefault();
        img.setPointerCapture?.(event.pointerId);
        activePointers.set(event.pointerId, focal(event));

        if (activePointers.size === 1) {
            const p = activePointers.get(event.pointerId);
            swipeStart = { x: p.x, y: p.y };
            panLast = { x: p.x, y: p.y };
        } else if (activePointers.size === 2) {
            gestureWasPinch = true;
            const [a, b] = [...activePointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const { cx, cy } = center();
            // Image-local point currently under the pinch midpoint; anchor it there.
            pinchStart = {
                dist,
                s0: imgTransform.scale,
                P0x: cx + (mid.x - cx - imgTransform.tx) / imgTransform.scale,
                P0y: cy + (mid.y - cy - imgTransform.ty) / imgTransform.scale,
            };
        }
    });

    img.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") return;
        if (!activePointers.has(event.pointerId)) return;
        activePointers.set(event.pointerId, focal(event));

        if (activePointers.size >= 2 && pinchStart) {
            const [a, b] = [...activePointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const { cx, cy } = center();
            imgTransform.scale = Math.min(MAX_SCALE, Math.max(1, pinchStart.s0 * (dist / pinchStart.dist)));
            imgTransform.tx = mid.x - cx - imgTransform.scale * (pinchStart.P0x - cx);
            imgTransform.ty = mid.y - cy - imgTransform.scale * (pinchStart.P0y - cy);
            clampTranslation();
            applyImageTransform();
        } else if (activePointers.size === 1 && imgTransform.scale > 1 && panLast) {
            const p = activePointers.get(event.pointerId);
            imgTransform.tx += p.x - panLast.x;
            imgTransform.ty += p.y - panLast.y;
            panLast = { x: p.x, y: p.y };
            clampTranslation();
            applyImageTransform();
        }
    });

    const endPointer = (event) => {
        if (event.pointerType === "mouse") return;
        if (!activePointers.has(event.pointerId)) return;
        const last = activePointers.get(event.pointerId);
        activePointers.delete(event.pointerId);

        if (activePointers.size === 1) {
            // One finger lifted mid-pinch — re-anchor panning to the survivor
            const [p] = [...activePointers.values()];
            panLast = { x: p.x, y: p.y };
            pinchStart = null;
            return;
        }
        if (activePointers.size > 1) return;

        // All fingers up
        if (gestureWasPinch) {
            gestureWasPinch = false;
            pinchStart = null;
            if (imgTransform.scale <= 1.01) resetImageTransform();
            return;
        }

        const dx = last.x - (swipeStart ? swipeStart.x : last.x);
        const dy = last.y - (swipeStart ? swipeStart.y : last.y);
        const moved = Math.hypot(dx, dy);

        if (moved < TAP_MOVE_TOL) {
            // Tap — double-tap toggles zoom
            const now = Date.now();
            if (now - lastTapTime < DOUBLE_TAP_MS) {
                if (imgTransform.scale > 1) {
                    resetImageTransform();
                } else {
                    const { cx, cy } = center();
                    imgTransform.scale = DOUBLE_TAP_SCALE;
                    imgTransform.tx = last.x - cx - DOUBLE_TAP_SCALE * (last.x - cx);
                    imgTransform.ty = last.y - cy - DOUBLE_TAP_SCALE * (last.y - cy);
                    clampTranslation();
                    applyImageTransform();
                }
                lastTapTime = 0;
            } else {
                lastTapTime = now;
            }
        } else if (imgTransform.scale > 1) {
            // Drag while zoomed was a pan — nothing else to do
        } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
            if (dx > 0) navigateToPrevious();
            else navigateToNext();
        } else if (dy > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
            closeLightbox();
        }

        swipeStart = null;
        panLast = null;
    };

    img.addEventListener("pointerup", endPointer);
    img.addEventListener("pointercancel", endPointer);
}

// Make functions available globally
window.Lightbox = {
    preloadAdjacentMedia,
    openLightbox,
    navigateToPrevious,
    navigateToNext,
    closeLightbox,
    handleLightboxClick,
    initLightbox,
};
