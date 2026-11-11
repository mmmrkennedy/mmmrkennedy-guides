import { log } from "../core/logger";

let allTriggers: HTMLAnchorElement[] = [];
let currentIndex = -1;
const preloadedUrls = new Set<string>();

// Guide screenshots are 2560px masters on R2, with downscaled copies at these
// widths behind ?w= (see functions/games/[[path]].js).
// Ascending. Must match TIERS in build_scripts/r2.mjs and the Function.
const TIERS = [1280, 1920];

// currentTier null means the master is loaded.
let currentMasterSrc = "";
let currentTier: number | null = null;
let upgradeInFlight = false;

// Rotate mode: a 16:9 shot on a portrait phone fills about a quarter of the
// screen. Rotated, it shows ~3x bigger, and works even with rotation lock on.
const TOUCH_QUERY = "(hover: none), (pointer: coarse)";
const ROTATE_PREF_KEY = "lightbox-rotate";

let isRotated = false;
let currentNatural: { w: number; h: number } | null = null;

function isTouch(): boolean {
    return window.matchMedia(TOUCH_QUERY).matches;
}

function isPortrait(): boolean {
    return window.matchMedia("(orientation: portrait)").matches;
}

function rotatePref(): boolean {
    try {
        return localStorage.getItem(ROTATE_PREF_KEY) === "1";
    } catch {
        return false;
    }
}

function setRotatePref(on: boolean): void {
    try {
        if (on) localStorage.setItem(ROTATE_PREF_KEY, "1");
        else localStorage.removeItem(ROTATE_PREF_KEY);
    } catch {
        // Private mode: the toggle still works for this visit.
    }
}

/** Desktop shows the caption beside the image, touch shows it in the bar. */
function setCaption(text: string): void {
    const caption = document.querySelector(".lightbox-caption");
    const title = document.querySelector(".lightbox-title");
    if (caption) caption.textContent = text;
    if (title) title.textContent = text;
}

/** Only guide screenshots go through the images Function; leave anything else alone. */
function canTier(src: string): boolean {
    try {
        const u = new URL(src, location.href);
        return u.origin === location.origin && /^\/games\/.+\.webp$/i.test(u.pathname);
    } catch {
        return false;
    }
}

function withTier(src: string, tier: number | null): string {
    if (!canTier(src)) return src;
    const u = new URL(src, location.href);
    if (tier === null) u.searchParams.delete("w");
    else u.searchParams.set("w", String(tier));
    return u.toString();
}

/**
 * Smallest tier covering the painted box, or null for the master. The image is
 * capped at 90vh and 100vw. Runs before the image's shape is known, so it assumes
 * a 16:9 landscape shot. On 2x+ screens a tier within 10% of the need is close
 * enough (a rotated 3x phone wants ~2080px, and 1920 looks the same); at 1x the
 * upscale is visible, so a 1440p monitor (~2080px painted) gets the master.
 */
function tierForViewport(): number | null {
    const dpr = window.devicePixelRatio || 1;
    const rotated = isTouch() && isPortrait() && rotatePref();
    const w = rotated ? window.innerHeight : window.innerWidth;
    const h = rotated ? window.innerWidth : window.innerHeight;
    const byWidth = w * dpr;
    const byHeight = h * 0.9 * (16 / 9) * dpr;
    const needed = Math.min(byWidth, byHeight) * (dpr >= 2 ? 0.9 : 1);
    return TIERS.find((t) => t >= needed) ?? null;
}

function tieredUrl(src: string): string {
    return withTier(src, canTier(src) ? tierForViewport() : null);
}

/** null means the master; undefined means already at the master. */
function nextTierUp(current: number | null): number | null | undefined {
    if (current === null) return undefined;
    const i = TIERS.indexOf(current);
    if (i === -1) return undefined;
    return i + 1 < TIERS.length ? TIERS[i + 1] : null;
}

// Must match the .lightbox transition in layout.css
const FADE_MS = 200;

// Most opens resolve in a few ms (preloaded or cached), so an instant spinner would flash.
const SPINNER_DELAY_MS = 150;
let spinnerTimer: number | null = null;

// Bumped on every open so a slow load from a previous item is dropped.
let loadToken = 0;

// Touch/pen only; mouse uses the click-to-zoom path.
const imgTransform = { scale: 1, tx: 0, ty: 0 };
const activePointers = new Map<number, { x: number; y: number }>();
let gestureWasPinch = false;
let pinchStart: { dist: number; s0: number; P0x: number; P0y: number } | null = null;
let panLast: { x: number; y: number } | null = null;
let swipeStart: { x: number; y: number } | null = null;
let lastTapTime = 0;
let tapTimer: number | null = null; // pending single tap, toggles the bar
let lastPointerType = "mouse";
let navPrevBtn: HTMLButtonElement | null = null;
let navNextBtn: HTMLButtonElement | null = null;
let fittedSize: { width: string; height: string } | null = null; // restored after desktop zoom-out
let lastFocused: HTMLElement | null = null;

function getFocusableElements(): HTMLElement[] {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return [];
    const candidates = lightbox.querySelectorAll<HTMLElement>(
        "button:not([disabled]), video[controls], audio[controls]"
    );
    return Array.from(candidates).filter((el) => el.offsetParent !== null);
}

/** Rotation goes innermost so translate and scale stay in screen pixels. */
function applyImageTransform(): void {
    const img = document.getElementById("lightbox-img");
    if (!img) return;
    const { tx, ty, scale } = imgTransform;
    const zoomed = scale !== 1 || tx !== 0 || ty !== 0;
    const parts = zoomed ? [`translate(${tx}px, ${ty}px)`, `scale(${scale})`] : [];
    if (isRotated) parts.push("rotate(90deg)");
    img.style.transform = parts.join(" ");
}

function resetImageTransform(): void {
    imgTransform.scale = 1;
    imgTransform.tx = 0;
    imgTransform.ty = 0;
    applyImageTransform();
}

function clampTranslation(): void {
    const lightbox = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    if (!lightbox || !img) return;
    // A rotated image's layout box is its unrotated shape; on screen the sides swap.
    const w = isRotated ? img.offsetHeight : img.offsetWidth;
    const h = isRotated ? img.offsetWidth : img.offsetHeight;
    const maxX = Math.max(0, (w * imgTransform.scale - lightbox.clientWidth) / 2);
    const maxY = Math.max(0, (h * imgTransform.scale - lightbox.clientHeight) / 2);
    imgTransform.tx = Math.min(maxX, Math.max(-maxX, imgTransform.tx));
    imgTransform.ty = Math.min(maxY, Math.max(-maxY, imgTransform.ty));
}

function updateNavButtons(): void {
    if (!navPrevBtn || !navNextBtn) return;
    // Touch screens swipe between items instead.
    const showArrows = allTriggers.length > 1 && !isTouch();
    navPrevBtn.style.display = showArrows ? "flex" : "none";
    navNextBtn.style.display = showArrows ? "flex" : "none";
    navPrevBtn.disabled = currentIndex <= 0;
    navNextBtn.disabled = currentIndex >= allTriggers.length - 1;
}

function fitImage(): void {
    const lightbox = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    if (!lightbox || !img || !currentNatural) return;
    const { w, h } = currentNatural;

    // Only a landscape image on a portrait touch screen gains anything from it.
    const canRotate = isTouch() && isPortrait() && w > h;
    isRotated = canRotate && rotatePref();
    lightbox.classList.toggle("can-rotate", canRotate);
    lightbox.classList.toggle("is-rotated", isRotated);
    document.querySelector(".lightbox-rotate")?.setAttribute("aria-pressed", String(rotatePref()));

    img.style.width = "";
    img.style.height = "";
    const SMALL_THRESHOLD = 600;
    const MAX_SCALE = 3;
    if (w < SMALL_THRESHOLD && h < SMALL_THRESHOLD) {
        const screenW = isRotated ? window.innerHeight : window.innerWidth;
        const screenH = isRotated ? window.innerWidth : window.innerHeight;
        const scale = Math.min(MAX_SCALE, (screenH * 0.8) / h, (screenW * 0.9) / w);
        if (scale > 1) {
            img.style.width = w * scale + "px";
            img.style.height = h * scale + "px";
        }
    }

    resetImageTransform();
}

function toggleRotate(): void {
    setRotatePref(!rotatePref());
    fitImage();
    // The rotated view wants more pixels; fetch them now, not on the first pinch.
    const img = document.getElementById("lightbox-img") as HTMLImageElement | null;
    if (isRotated && img) upgradeTier(img, false);
}

/**
 * Swaps in the next tier up without blocking the zoom. Steps one tier so a phone
 * doesn't pull a 5MB master; on desktop the tier above 1920 is the master.
 * `regrow` applies the new natural size (desktop 1:1 zoom); pinch leaves the box
 * alone since its transform magnifies. `toMaster` skips to the original for deep
 * zoom on high-DPR phones. A request already in flight wins.
 */
function upgradeTier(img: HTMLImageElement, regrow: boolean, toMaster = false): void {
    if (upgradeInFlight || !currentMasterSrc || !canTier(currentMasterSrc)) return;
    const up = toMaster ? null : nextTierUp(currentTier);
    if (up === undefined || currentTier === null) return; // already the master

    upgradeInFlight = true;
    const url = withTier(currentMasterSrc, up);
    const token = loadToken;

    const pre = new Image();
    pre.src = url;
    pre.onerror = () => {
        if (token === loadToken) upgradeInFlight = false;
    };
    pre.onload = () => {
        if (token !== loadToken) return;
        upgradeInFlight = false;
        currentTier = up;
        img.setAttribute("src", url);
        if (regrow && pre.naturalWidth) {
            img.style.width = pre.naturalWidth + "px";
            img.style.height = pre.naturalHeight + "px";
        }
    };
}

function zoomInDesktop(lightbox: HTMLElement, img: HTMLImageElement, event: MouseEvent): void {
    if (!img.naturalWidth) return;
    upgradeTier(img, true);

    const rect = img.getBoundingClientRect();
    const pctX = (event.clientX - rect.left) / rect.width;
    const pctY = (event.clientY - rect.top) / rect.height;

    // May be "" for large images.
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

function zoomOutDesktop(lightbox: HTMLElement, img: HTMLImageElement): void {
    lightbox.classList.remove("zoomed");
    img.style.width = fittedSize ? fittedSize.width : "";
    img.style.height = fittedSize ? fittedSize.height : "";
    lightbox.scrollLeft = 0;
    lightbox.scrollTop = 0;
}

function hideSpinner(): void {
    if (spinnerTimer !== null) {
        window.clearTimeout(spinnerTimer);
        spinnerTimer = null;
    }
    document.querySelector(".lightbox-spinner")?.setAttribute("hidden", "");
}

function scheduleSpinner(token: number): void {
    hideSpinner();
    spinnerTimer = window.setTimeout(() => {
        spinnerTimer = null;
        if (token !== loadToken) return;
        document.querySelector(".lightbox-spinner")?.removeAttribute("hidden");
    }, SPINNER_DELAY_MS);
}

function preloadAdjacentMedia(index: number): void {
    if (!allTriggers.length) return;

    const toPreload: HTMLAnchorElement[] = [];
    if (index > 0) toPreload.push(allTriggers[index - 1]);
    if (index < allTriggers.length - 1) toPreload.push(allTriggers[index + 1]);

    // This viewport's tier, not the multi-MB master.
    const tier = tierForViewport();

    toPreload.forEach((trigger) => {
        if (trigger.dataset.mediaType !== "image") return;
        const url = withTier(trigger.href, tier);
        if (preloadedUrls.has(url)) return;
        preloadedUrls.add(url);
        new Image().src = url;
    });
}

function openLightbox(mediaSrc: string, captionText: string, index: number, mediaType: string): void {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxVideo = document.getElementById("lightbox-video") as HTMLVideoElement | null;
    const lightboxAudio = document.getElementById("lightbox-audio") as HTMLAudioElement | null;

    if (!lightbox || !lightboxImg || !lightboxVideo || !lightboxAudio) return;

    // Only on the initial open; while navigating, focus is already inside.
    const wasOpen = lightbox.classList.contains("is-open");
    if (!wasOpen && document.activeElement instanceof HTMLElement) {
        lastFocused = document.activeElement;
    }

    currentIndex = index;
    const token = ++loadToken;

    // fitImage() re-decides rotate once the image's shape is known.
    lightbox.classList.remove("zoomed", "is-rotated", "can-rotate");
    isRotated = false;
    currentNatural = null;
    resetImageTransform();
    updateNavButtons();

    lightbox.style.display = "flex";
    requestAnimationFrame(() => lightbox.classList.add("is-open"));
    if (!wasOpen) {
        const closeBtn = lightbox.querySelector<HTMLElement>(".close-lightbox");
        if (closeBtn) requestAnimationFrame(() => closeBtn.focus());
    }
    lightboxImg.style.display = "none";
    lightboxVideo.style.display = "none";
    lightboxAudio.style.display = "none";
    // Stale callbacks could fire late and un-hide media that's no longer current.
    lightboxVideo.onloadedmetadata = null;
    lightboxVideo.onerror = null;
    lightboxAudio.onloadeddata = null;
    lightboxAudio.onerror = null;
    lightboxVideo.pause();
    lightboxAudio.pause();
    setCaption("Loading...");
    scheduleSpinner(token);

    if (mediaType === "image") {
        // The Function falls back to the master when no variant exists.
        currentMasterSrc = mediaSrc;
        currentTier = canTier(mediaSrc) ? tierForViewport() : null;
        upgradeInFlight = false;
        const tieredSrc = withTier(mediaSrc, currentTier);

        const img = new Image();
        img.src = tieredSrc;
        img.onload = function () {
            if (token !== loadToken) return;
            hideSpinner();
            lightboxImg.setAttribute("src", tieredSrc);

            currentNatural = { w: img.naturalWidth, h: img.naturalHeight };
            fitImage();

            lightboxImg.style.display = "block";
            setCaption(captionText);

            preloadAdjacentMedia(currentIndex);
        };

        img.onerror = function () {
            if (token !== loadToken) return;
            hideSpinner();
            setCaption("Error loading image");
            lightboxImg.style.display = "none";
        };
    } else if (mediaType === "video") {
        setCaption(captionText);

        lightboxVideo.onerror = function () {
            hideSpinner();
            setCaption("Error loading video");
            lightboxVideo.style.display = "none";
        };

        // A <video> lays out at 300x150 until metadata loads; revealing earlier flashes an empty frame.
        const reveal = (): void => {
            hideSpinner();
            lightboxVideo.style.display = "block";
        };

        // Assigning src reloads even for the same URL (readyState back to
        // HAVE_NOTHING), so skip it on a repeat view.
        const resolvedSrc = new URL(mediaSrc, document.baseURI).href;
        if (lightboxVideo.src !== resolvedSrc || lightboxVideo.error) {
            lightboxVideo.onloadedmetadata = reveal;
            lightboxVideo.setAttribute("src", resolvedSrc);
        } else if (lightboxVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
            reveal();
        } else {
            lightboxVideo.onloadedmetadata = reveal;
        }

        lightboxVideo.play().catch((e) => {
            log("warn", "Auto-play prevented:", e);
        });
    } else if (mediaType === "audio") {
        // The audio player shows its own buffering state.
        hideSpinner();
        lightboxAudio.setAttribute("src", mediaSrc);
        lightboxAudio.style.display = "block";
        setCaption(captionText);

        lightboxAudio.onloadeddata = function () {
            setCaption(captionText);
        };

        lightboxAudio.onerror = function () {
            setCaption("Error loading audio");
            lightboxAudio.style.display = "none";
        };

        // The opening click is a user gesture, so autoplay with sound is allowed
        lightboxAudio.play().catch((e) => {
            log("warn", "Auto-play prevented:", e);
        });
    }
}

function navigateToPrevious(): void {
    if (currentIndex <= 0) return;
    const prevTrigger = allTriggers[currentIndex - 1];
    let captionText = prevTrigger.dataset.caption || prevTrigger.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    openLightbox(prevTrigger.href, captionText, currentIndex - 1, prevTrigger.dataset.mediaType ?? "");
}

function navigateToNext(): void {
    if (currentIndex >= allTriggers.length - 1) return;
    const nextTrigger = allTriggers[currentIndex + 1];
    let captionText = nextTrigger.dataset.caption || nextTrigger.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    openLightbox(nextTrigger.href, captionText, currentIndex + 1, nextTrigger.dataset.mediaType ?? "");
}

function closeLightbox(): void {
    // So an in-flight load can't re-reveal media after the close.
    loadToken++;
    hideSpinner();

    const lightbox = document.getElementById("lightbox");
    const lightboxVideo = document.getElementById("lightbox-video") as HTMLVideoElement | null;
    const lightboxAudio = document.getElementById("lightbox-audio") as HTMLAudioElement | null;

    if (lightbox) {
        // The guard lets a re-open during the fade cancel the pending hide.
        lightbox.classList.remove("is-open");
        lightbox.classList.remove("zoomed", "chrome-hidden");
        window.setTimeout(() => {
            if (!lightbox.classList.contains("is-open")) lightbox.style.display = "none";
        }, FADE_MS);
    }

    if (tapTimer !== null) {
        window.clearTimeout(tapTimer);
        tapTimer = null;
    }
    resetImageTransform();

    if (lightboxVideo) {
        lightboxVideo.pause();
        lightboxVideo.currentTime = 0;
    }

    if (lightboxAudio) {
        lightboxAudio.pause();
        lightboxAudio.currentTime = 0;
    }

    if (lastFocused) lastFocused.focus();
    lastFocused = null;

    currentIndex = -1;
}

function handleLightboxClick(this: HTMLAnchorElement): void {
    let captionText = this.dataset.caption || this.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    const index = allTriggers.indexOf(this);
    openLightbox(this.href, captionText, index, this.dataset.mediaType ?? "");
}

/** Delegated so links rendered later (React solvers) work without a re-init. */
function initLightbox(): void {
    const lightbox = document.getElementById("lightbox");
    const closeBtn = document.querySelector<HTMLElement>(".close-lightbox");

    if (!lightbox || !closeBtn) {
        log("warn", "Lightbox elements not found");
        return;
    }

    closeBtn.addEventListener("click", closeLightbox);

    // On touch, a background tap toggles the bar instead (see setupGestures).
    lightbox.addEventListener("click", (event) => {
        if (lastPointerType === "touch" || lastPointerType === "pen") return;
        if (event.target === lightbox) closeLightbox();
    });

    document.querySelector(".lightbox-rotate")?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleRotate();
    });

    // Turning the phone changes whether rotate mode applies at all.
    window.matchMedia("(orientation: portrait)").addEventListener("change", () => {
        if (lightbox.classList.contains("is-open")) fitImage();
    });

    const lightboxImg = document.getElementById("lightbox-img") as HTMLImageElement | null;
    if (lightboxImg) {
        lightboxImg.addEventListener("click", (event) => {
            event.stopPropagation();

            // Touch/pen taps are handled by setupGestures.
            if (lastPointerType === "touch" || lastPointerType === "pen") return;

            if (!lightbox.classList.contains("zoomed")) {
                zoomInDesktop(lightbox, lightboxImg, event);
            } else {
                zoomOutDesktop(lightbox, lightboxImg);
            }
        });
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        const anchor = target instanceof Element ? target.closest("a") : null;
        if (!anchor) return;

        const href = anchor.getAttribute("href");
        if (!href) return;

        const videoExtensions = [".webm", ".mp4", ".mov"];
        const audioExtensions = [".flac", ".mp3", ".ogg", ".wav", ".m4a"];
        const mediaExtensions = [".webp", ".jpg", ".jpeg", ".png", ".gif", ...videoExtensions, ...audioExtensions];
        const hrefLower = href.toLowerCase();
        const isMedia = mediaExtensions.some((ext) => hrefLower.endsWith(ext));
        if (!isMedia) return;

        event.preventDefault();

        if (!anchor.classList.contains("lightbox-trigger")) {
            anchor.classList.add("lightbox-trigger");
            anchor.dataset.mediaType = videoExtensions.some((ext) => hrefLower.endsWith(ext))
                ? "video"
                : audioExtensions.some((ext) => hrefLower.endsWith(ext))
                  ? "audio"
                  : "image";
        }

        allTriggers = Array.from(document.querySelectorAll<HTMLAnchorElement>(".lightbox-trigger"));

        handleLightboxClick.call(anchor);
    });

    navPrevBtn = document.querySelector<HTMLButtonElement>(".lightbox-prev");
    navNextBtn = document.querySelector<HTMLButtonElement>(".lightbox-next");
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

    if (lightboxImg) setupGestures(lightbox, lightboxImg);

    document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("is-open")) return;

        if (event.key === "Escape") {
            closeLightbox();
        } else if (event.key === "ArrowLeft") {
            navigateToPrevious();
        } else if (event.key === "ArrowRight") {
            navigateToNext();
        } else if (event.key === "Tab") {
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
    });
}

/**
 * Mouse pointers are ignored so desktop keeps click-to-zoom. Listens on the whole
 * viewer, not the image, since on a portrait phone the image is a thin strip.
 */
function setupGestures(lightbox: HTMLElement, img: HTMLImageElement): void {
    const SWIPE_THRESHOLD = 50; // px before a drag counts as a swipe
    const TAP_MOVE_TOL = 12; // px of movement still treated as a tap
    const DOUBLE_TAP_MS = 300;
    const MAX_SCALE = 4;
    const DOUBLE_TAP_SCALE = 2.5;
    // Deliberate zoom rather than two-finger pan drift, before fetching more pixels.
    const PINCH_UPGRADE_SCALE = 1.5;
    // Past this, a 3x phone wants more than the 1920 tier has.
    const PINCH_MASTER_SCALE = 2.25;

    const center = () => ({ cx: lightbox.clientWidth / 2, cy: lightbox.clientHeight / 2 });
    const focal = (event: PointerEvent) => {
        const rect = lightbox.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    // Zoom is for images only; video and audio still get swipes and taps.
    const imageShown = () => img.style.display === "block";

    lightbox.addEventListener("pointerdown", (event) => {
        lastPointerType = event.pointerType;
        if (event.pointerType === "mouse") return;
        // Buttons and native media controls keep their own taps.
        if ((event.target as Element).closest("button, video, audio")) return;
        event.preventDefault();
        lightbox.setPointerCapture?.(event.pointerId);
        activePointers.set(event.pointerId, focal(event));

        if (activePointers.size === 1) {
            const p = activePointers.get(event.pointerId)!;
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

    lightbox.addEventListener("pointermove", (event) => {
        if (event.pointerType === "mouse") return;
        if (!activePointers.has(event.pointerId)) return;
        activePointers.set(event.pointerId, focal(event));

        if (activePointers.size >= 2 && pinchStart && imageShown()) {
            const ps = pinchStart;
            const [a, b] = [...activePointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const { cx, cy } = center();
            imgTransform.scale = Math.min(MAX_SCALE, Math.max(1, ps.s0 * (dist / ps.dist)));
            imgTransform.tx = mid.x - cx - imgTransform.scale * (ps.P0x - cx);
            imgTransform.ty = mid.y - cy - imgTransform.scale * (ps.P0y - cy);
            clampTranslation();
            applyImageTransform();
            // No regrow: the transform magnifies, only the source sharpens.
            if (imgTransform.scale > PINCH_MASTER_SCALE) upgradeTier(img, false, true);
            else if (imgTransform.scale > PINCH_UPGRADE_SCALE) upgradeTier(img, false);
        } else if (activePointers.size === 1 && imgTransform.scale > 1 && panLast) {
            const pl = panLast;
            const p = activePointers.get(event.pointerId)!;
            imgTransform.tx += p.x - pl.x;
            imgTransform.ty += p.y - pl.y;
            panLast = { x: p.x, y: p.y };
            clampTranslation();
            applyImageTransform();
        }
    });

    const endPointer = (event: PointerEvent) => {
        if (event.pointerType === "mouse") return;
        if (!activePointers.has(event.pointerId)) return;
        const last = activePointers.get(event.pointerId)!;
        activePointers.delete(event.pointerId);

        if (activePointers.size === 1) {
            // One finger lifted mid-pinch: pan from the survivor.
            const [p] = [...activePointers.values()];
            panLast = { x: p.x, y: p.y };
            pinchStart = null;
            return;
        }
        if (activePointers.size > 1) return;

        if (gestureWasPinch) {
            gestureWasPinch = false;
            pinchStart = null;
            if (imgTransform.scale <= 1.01) resetImageTransform();
            return;
        }

        const sx = last.x - (swipeStart ? swipeStart.x : last.x);
        const sy = last.y - (swipeStart ? swipeStart.y : last.y);
        const moved = Math.hypot(sx, sy);
        // Swipes are read the way the reader holds the phone: rotated, their
        // "down" is the screen's left and their "right" is the screen's down.
        const dx = isRotated ? sy : sx;
        const dy = isRotated ? -sx : sy;

        if (moved < TAP_MOVE_TOL) {
            // A single tap waits out the double-tap window so a zoom doesn't flicker the bar.
            const now = Date.now();
            if (now - lastTapTime < DOUBLE_TAP_MS) {
                if (tapTimer !== null) {
                    window.clearTimeout(tapTimer);
                    tapTimer = null;
                }
                if (!imageShown()) {
                    // Nothing to zoom
                } else if (imgTransform.scale > 1) {
                    resetImageTransform();
                } else {
                    const { cx, cy } = center();
                    imgTransform.scale = DOUBLE_TAP_SCALE;
                    imgTransform.tx = last.x - cx - DOUBLE_TAP_SCALE * (last.x - cx);
                    imgTransform.ty = last.y - cy - DOUBLE_TAP_SCALE * (last.y - cy);
                    clampTranslation();
                    applyImageTransform();
                    // Skips pointermove, so it needs its own upgrade.
                    upgradeTier(img, false, true);
                }
                lastTapTime = 0;
            } else {
                lastTapTime = now;
                tapTimer = window.setTimeout(() => {
                    tapTimer = null;
                    lightbox.classList.toggle("chrome-hidden");
                }, DOUBLE_TAP_MS);
            }
        } else if (imgTransform.scale > 1) {
            // Drag while zoomed was a pan
        } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
            if (dx > 0) navigateToPrevious();
            else navigateToNext();
        } else if (dy > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
            closeLightbox();
        }

        swipeStart = null;
        panLast = null;
    };

    lightbox.addEventListener("pointerup", endPointer);
    lightbox.addEventListener("pointercancel", endPointer);
}

document.addEventListener("DOMContentLoaded", initLightbox);

document.addEventListener("DOMContentLoaded", () => {
    const imageCache = new Map<string, HTMLImageElement>();

    function loadImage(imgUrl: string): void {
        if (imageCache.has(imgUrl)) return;
        const img = new Image();
        img.onerror = () => log("error", "Failed to load image:", imgUrl);
        img.src = imgUrl;
        imageCache.set(imgUrl, img);
    }

    document.querySelectorAll<HTMLAnchorElement>("a.lightbox-trigger").forEach((aTag) => {
        const imageUrl = aTag.getAttribute("href");
        if (!imageUrl) return;
        // Warm the tier the lightbox will request, not the master. Resolved per
        // event since viewport and DPR can change.
        const warm = () => loadImage(tieredUrl(imageUrl));
        aTag.addEventListener("pointerenter", warm, { once: true });
        aTag.addEventListener("click", warm, { once: true });
    });
});
