/**
 * Lightbox system for images and videos
 * Handles media display, navigation, and keyboard controls
 */

let allTriggers = [];
let currentIndex = -1;
const preloadedUrls = new Set();

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

    // Update current index
    currentIndex = index;

    // Reset zoom state for each new image
    lightbox.classList.remove("zoomed");

    // Show a loading state
    lightbox.style.display = "flex";
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
        lightbox.style.display = "none";
        lightbox.classList.remove("zoomed");
    }

    if (lightboxVideo) {
        lightboxVideo.pause();
        lightboxVideo.currentTime = 0;
    }

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

            if (!lightbox.classList.contains("zoomed")) {
                // Record click position as % of the current (constrained) image size
                const rect = lightboxImg.getBoundingClientRect();
                const pctX = (event.clientX - rect.left) / rect.width;
                const pctY = (event.clientY - rect.top) / rect.height;

                lightbox.classList.add("zoomed");

                // After layout updates to natural image size, scroll so the
                // clicked point is centered in the viewport
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        const scrollX = pctX * lightboxImg.offsetWidth - lightbox.clientWidth / 2;
                        const scrollY = pctY * lightboxImg.offsetHeight - lightbox.clientHeight / 2;

                        lightbox.scrollLeft = Math.max(0, scrollX);
                        lightbox.scrollTop = Math.max(0, scrollY);
                    });
                });
            } else {
                lightbox.classList.remove("zoomed");
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

    // Add keyboard event listeners
    document.addEventListener("keydown", (event) => {
        if (lightbox.style.display === "flex") {
            if (event.key === "Escape") {
                closeLightbox();
            } else if (event.key === "ArrowLeft") {
                navigateToPrevious();
            } else if (event.key === "ArrowRight") {
                navigateToNext();
            }
        }
    });
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
