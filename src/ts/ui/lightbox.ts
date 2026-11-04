import { log } from "../core/logger";

/**
 * Lightbox system for images, video, and audio
 * Handles media display, navigation, and keyboard controls
 */

let allTriggers: HTMLAnchorElement[] = [];
let currentIndex = -1;
const preloadedUrls = new Set<string>();

// ---------------------------------------------------------------------------
// Resolution tiers
//
// Guide screenshots are 2560px masters served from R2, with downscaled copies at
// these widths behind ?w= (see functions/games/[[path]].js). A phone paints the
// lightbox about 390 CSS px wide, so it needs ~1170 real pixels — not 2560, and
// certainly not the 5MB some masters weigh.
//
// Ascending. Must match TIERS in build_scripts/r2.mjs and the Function.
// ---------------------------------------------------------------------------
const TIERS = [1280, 1920];

// The un-tiered URL of the image on screen, and which tier is actually loaded
// (null means the master). Kept so zoom can ask for the next one up.
let currentMasterSrc = "";
let currentTier: number | null = null;
let upgradeInFlight = false;

// ---------------------------------------------------------------------------
// Touch screens get a full-screen viewer: no arrows (swipe instead), a bar over
// the top that a tap hides, and an optional rotate mode. A 16:9 screenshot on a
// portrait phone fills about a quarter of the screen. Rotated, it lies along the
// long side, so turning the phone shows it about three times bigger, and that
// works even with rotation lock on. Once the phone really is landscape, the
// rotation drops away and the image still fills the screen.
// ---------------------------------------------------------------------------
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

/** Writes the caption into both places: beside the image on desktop, in the bar on touch. */
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

/** Same URL with ?w= set, or removed entirely for the master. */
function withTier(src: string, tier: number | null): string {
    if (!canTier(src)) return src;
    const u = new URL(src, location.href);
    if (tier === null) u.searchParams.delete("w");
    else u.searchParams.set("w", String(tier));
    return u.toString();
}

/**
 * Smallest tier that covers the box the lightbox will paint into, or null for
 * the master.
 *
 * The image is capped at 90vh AND 100vw, so for a 16:9 screenshot the rendered
 * width is bounded by both — height is usually the binding one on a desktop and
 * width on a phone. Multiplied by devicePixelRatio, because a 390px-wide phone
 * at 3x still wants ~1170 real pixels.
 *
 * Rotate mode swaps the screen's sides, because the image then lies along the
 * long one. Runs before the image's own shape is known, so it assumes landscape,
 * which nearly every screenshot is. A tier within 10% of the need is close enough:
 * a rotated 3x phone wants ~2080px, and 1920 looks the same at a fraction of the
 * master's size.
 */
function tierForViewport(): number | null {
    const dpr = window.devicePixelRatio || 1;
    const rotated = isTouch() && isPortrait() && rotatePref();
    const w = rotated ? window.innerHeight : window.innerWidth;
    const h = rotated ? window.innerWidth : window.innerHeight;
    const byWidth = w * dpr;
    const byHeight = h * 0.9 * (16 / 9) * dpr;
    const needed = Math.min(byWidth, byHeight) * 0.9;
    return TIERS.find((t) => t >= needed) ?? null;
}

/** This viewport's URL for an image — what anything preloading it should fetch. */
function tieredUrl(src: string): string {
    return withTier(src, canTier(src) ? tierForViewport() : null);
}

/** The next tier up, or undefined when already at the master. */
function nextTierUp(current: number | null): number | null | undefined {
    if (current === null) return undefined;
    const i = TIERS.indexOf(current);
    if (i === -1) return undefined;
    return i + 1 < TIERS.length ? TIERS[i + 1] : null;
}

// Open/close fade duration; must match the .lightbox transition in layout.css
const FADE_MS = 200;

// How long a load may run before the spinner appears. Adjacent items are
// preloaded and repeat views come from cache, so most opens resolve in a few
// ms — showing the spinner immediately would just flash it.
const SPINNER_DELAY_MS = 150;
let spinnerTimer: number | null = null;

// Bumped on every open. A slow item that resolves after the user has navigated
// on carries a stale token and is dropped, so it can't clear the spinner or
// paint itself over the item that replaced it.
let loadToken = 0;

// Touch gesture state (mobile pinch-zoom / pan / swipe). Desktop keeps the
// mouse click-to-zoom path below; these are only driven by touch/pen pointers.
const imgTransform = { scale: 1, tx: 0, ty: 0 };
const activePointers = new Map<number, { x: number; y: number }>();
let gestureWasPinch = false;
let pinchStart: { dist: number; s0: number; P0x: number; P0y: number } | null = null;
let panLast: { x: number; y: number } | null = null;
let swipeStart: { x: number; y: number } | null = null;
let lastTapTime = 0;
let tapTimer: number | null = null; // pending single tap, which hides or shows the bar
let lastPointerType = "mouse";
let navPrevBtn: HTMLButtonElement | null = null;
let navNextBtn: HTMLButtonElement | null = null;
let fittedSize: { width: string; height: string } | null = null; // restored after desktop zoom-out
let lastFocused: HTMLElement | null = null; // element focused before opening, restored on close

/** Returns the currently visible, focusable controls inside the lightbox (DOM order). */
function getFocusableElements(): HTMLElement[] {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return [];
    const candidates = lightbox.querySelectorAll<HTMLElement>(
        "button:not([disabled]), video[controls], audio[controls]"
    );
    return Array.from(candidates).filter((el) => el.offsetParent !== null);
}

/**
 * Applies the current pan/zoom transform to the lightbox image.
 *
 * The rotation goes innermost, so translate and scale stay in screen pixels and
 * the pinch and pan maths needs no changes for rotate mode.
 */
function applyImageTransform(): void {
    const img = document.getElementById("lightbox-img");
    if (!img) return;
    const { tx, ty, scale } = imgTransform;
    const zoomed = scale !== 1 || tx !== 0 || ty !== 0;
    const parts = zoomed ? [`translate(${tx}px, ${ty}px)`, `scale(${scale})`] : [];
    if (isRotated) parts.push("rotate(90deg)");
    img.style.transform = parts.join(" ");
}

/** Resets pan/zoom back to the fitted, centered state. */
function resetImageTransform(): void {
    imgTransform.scale = 1;
    imgTransform.tx = 0;
    imgTransform.ty = 0;
    applyImageTransform();
}

/** Keeps a zoomed image from being panned past its own edges. */
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

/** Shows/hides and enables/disables the prev/next arrows for the current item. */
function updateNavButtons(): void {
    const multiple = allTriggers.length > 1;

    // Touch screens swipe between items, so they get a count instead of arrows.
    const counter = document.querySelector(".lightbox-counter");
    if (counter) counter.textContent = multiple ? `${currentIndex + 1} / ${allTriggers.length}` : "";

    if (!navPrevBtn || !navNextBtn) return;
    const showArrows = multiple && !isTouch();
    navPrevBtn.style.display = showArrows ? "flex" : "none";
    navNextBtn.style.display = showArrows ? "flex" : "none";
    navPrevBtn.disabled = currentIndex <= 0;
    navNextBtn.disabled = currentIndex >= allTriggers.length - 1;
}

/**
 * Sizes the image for the screen: decides rotate mode, then upscales small images
 * so they don't render tiny. Runs on load, and again when the rotate button or
 * the phone's orientation changes.
 */
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

    // Threshold: natural dims both under 600px. Scale to fit ~80vh / 90vw, capped at 3x.
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

/** Turns rotate mode on or off, and remembers the choice for next time. */
function toggleRotate(): void {
    setRotatePref(!rotatePref());
    fitImage();
    // The rotated view wants more pixels; fetch them now, not on the first pinch.
    const img = document.getElementById("lightbox-img") as HTMLImageElement | null;
    if (isRotated && img) upgradeTier(img, false);
}

/**
 * Desktop (mouse) click-to-zoom: enlarge the image to its natural pixel size
 * and scroll so the clicked point is centered.
 */
/**
 * Fetches the next resolution up and swaps it in underneath the reader.
 *
 * Zooming is the one moment more pixels are actually wanted, and it is also the
 * moment a phone least wants a 5MB master — so this steps up one tier rather
 * than jumping to the original. On a desktop the tier above 1920 IS the master,
 * so pixel-peeping still ends up at full resolution.
 *
 * The swap never blocks the zoom: the reader gets the current pixels enlarged
 * immediately and they sharpen a moment later. `regrow` re-applies the new
 * natural size for the desktop path, where zoom means 1:1 pixels; the pinch path
 * leaves the box alone because its transform is doing the magnifying.
 *
 * `toMaster` skips straight to the original. A deep pinch or a double-tap on a
 * 3x phone wants more pixels than 1920, and stopping a tier short left close-up
 * detail soft. One step at a time, and a request already in flight wins.
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
        // Navigated on while this was in flight — dropping it stops a stale
        // image painting over whatever replaced it.
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
function zoomOutDesktop(lightbox: HTMLElement, img: HTMLImageElement): void {
    lightbox.classList.remove("zoomed");
    img.style.width = fittedSize ? fittedSize.width : "";
    img.style.height = fittedSize ? fittedSize.height : "";
    lightbox.scrollLeft = 0;
    lightbox.scrollTop = 0;
}

/** Cancels a pending spinner reveal and hides the spinner if it is already up. */
function hideSpinner(): void {
    if (spinnerTimer !== null) {
        window.clearTimeout(spinnerTimer);
        spinnerTimer = null;
    }
    document.querySelector(".lightbox-spinner")?.setAttribute("hidden", "");
}

/** Schedules the spinner to appear if `token` is still the current load. */
function scheduleSpinner(token: number): void {
    hideSpinner();
    spinnerTimer = window.setTimeout(() => {
        spinnerTimer = null;
        if (token !== loadToken) return;
        document.querySelector(".lightbox-spinner")?.removeAttribute("hidden");
    }, SPINNER_DELAY_MS);
}

/** Preloads adjacent media for faster navigation. */
function preloadAdjacentMedia(index: number): void {
    if (!allTriggers.length) return;

    const toPreload: HTMLAnchorElement[] = [];
    if (index > 0) toPreload.push(allTriggers[index - 1]);
    if (index < allTriggers.length - 1) toPreload.push(allTriggers[index + 1]);

    // Preload the tier this viewport will actually ask for. Fetching the master
    // here meant a phone speculatively downloading several MB of full-size
    // screenshots it would never display at that size.
    const tier = tierForViewport();

    toPreload.forEach((trigger) => {
        if (trigger.dataset.mediaType !== "image") return;
        const url = withTier(trigger.href, tier);
        if (preloadedUrls.has(url)) return;
        preloadedUrls.add(url);
        new Image().src = url;
    });
}

/** Opens the lightbox with the specified media source. */
function openLightbox(mediaSrc: string, captionText: string, index: number, mediaType: string): void {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxVideo = document.getElementById("lightbox-video") as HTMLVideoElement | null;
    const lightboxAudio = document.getElementById("lightbox-audio") as HTMLAudioElement | null;

    if (!lightbox || !lightboxImg || !lightboxVideo || !lightboxAudio) return;

    // Remember what to return focus to — only on the initial open, not while
    // navigating between items (where focus is already inside the dialog).
    const wasOpen = lightbox.classList.contains("is-open");
    if (!wasOpen && document.activeElement instanceof HTMLElement) {
        lastFocused = document.activeElement;
    }

    currentIndex = index;
    const token = ++loadToken;

    // Reset zoom and rotate state for each new item; fitImage() decides rotate
    // again once an image knows its own shape.
    lightbox.classList.remove("zoomed", "is-rotated", "can-rotate");
    isRotated = false;
    currentNatural = null;
    resetImageTransform();
    updateNavButtons();

    // Show a loading state (the .is-open class drives the fade/scale-in)
    lightbox.style.display = "flex";
    requestAnimationFrame(() => lightbox.classList.add("is-open"));
    if (!wasOpen) {
        // Move focus into the dialog so keyboard/AT users land on the controls
        const closeBtn = lightbox.querySelector<HTMLElement>(".close-lightbox");
        if (closeBtn) requestAnimationFrame(() => closeBtn.focus());
    }
    lightboxImg.style.display = "none";
    lightboxVideo.style.display = "none";
    lightboxAudio.style.display = "none";
    // Drop any pending reveal/error callbacks from the previous item so they
    // can't fire late and un-hide media that is no longer the current one.
    lightboxVideo.onloadedmetadata = null;
    lightboxVideo.onerror = null;
    lightboxAudio.onloadeddata = null;
    lightboxAudio.onerror = null;
    // Stop any video/audio still playing from the previous item before showing the next
    lightboxVideo.pause();
    lightboxAudio.pause();
    setCaption("Loading...");
    scheduleSpinner(token);

    if (mediaType === "image") {
        // Ask for the smallest copy that covers this screen. The Function falls
        // back to the master when no variant exists, so images too small to have
        // one — and any map not yet generated — still load normally.
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

        // A <video> with no metadata yet lays out at the default 300x150 box, so
        // showing it before it knows its own size flashes a small empty frame.
        // Reveal it only once the real dimensions are in.
        const reveal = (): void => {
            hideSpinner();
            lightboxVideo.style.display = "block";
        };

        // Assigning src re-runs the media load algorithm even when the URL is
        // unchanged, dropping readyState back to HAVE_NOTHING — that's why the
        // flash came back on every re-open. Skip the reload for a repeat view.
        const resolvedSrc = new URL(mediaSrc, document.baseURI).href;
        if (lightboxVideo.src !== resolvedSrc || lightboxVideo.error) {
            lightboxVideo.onloadedmetadata = reveal;
            lightboxVideo.setAttribute("src", resolvedSrc);
        } else if (lightboxVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
            reveal();
        } else {
            lightboxVideo.onloadedmetadata = reveal;
        }

        // Start playing the video (autoplay may be blocked by the browser)
        lightboxVideo.play().catch((e) => {
            log("warn", "Auto-play prevented:", e);
        });
    } else if (mediaType === "audio") {
        // The player is revealed straight away and shows its own buffering
        // state, so there is nothing for the spinner to sit on top of.
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

/** Navigates to the previous media item. */
function navigateToPrevious(): void {
    if (currentIndex <= 0) return;
    const prevTrigger = allTriggers[currentIndex - 1];
    let captionText = prevTrigger.dataset.caption || prevTrigger.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    openLightbox(prevTrigger.href, captionText, currentIndex - 1, prevTrigger.dataset.mediaType ?? "");
}

/** Navigates to the next media item. */
function navigateToNext(): void {
    if (currentIndex >= allTriggers.length - 1) return;
    const nextTrigger = allTriggers[currentIndex + 1];
    let captionText = nextTrigger.dataset.caption || nextTrigger.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    openLightbox(nextTrigger.href, captionText, currentIndex + 1, nextTrigger.dataset.mediaType ?? "");
}

/** Closes the lightbox and stops any playing videos. */
function closeLightbox(): void {
    // Invalidate any in-flight load so it can't re-reveal media after the close
    loadToken++;
    hideSpinner();

    const lightbox = document.getElementById("lightbox");
    const lightboxVideo = document.getElementById("lightbox-video") as HTMLVideoElement | null;
    const lightboxAudio = document.getElementById("lightbox-audio") as HTMLAudioElement | null;

    if (lightbox) {
        // Fade out, then hide once the transition has run. The guard lets a
        // re-open during the fade cancel the pending hide.
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

    // Return focus to whatever opened the lightbox
    if (lastFocused) lastFocused.focus();
    lastFocused = null;

    currentIndex = -1;
}

/** Handles a lightbox trigger click (invoked with the anchor as `this`). */
function handleLightboxClick(this: HTMLAnchorElement): void {
    let captionText = this.dataset.caption || this.textContent || "Media";
    captionText = captionText.charAt(0).toUpperCase() + captionText.slice(1);
    const index = allTriggers.indexOf(this);
    openLightbox(this.href, captionText, index, this.dataset.mediaType ?? "");
}

/**
 * Initializes the lightbox by setting up event listeners.
 * Uses event delegation so dynamically rendered links (e.g. React solvers)
 * are handled without needing a re-init after mount.
 */
function initLightbox(): void {
    const lightbox = document.getElementById("lightbox");
    const closeBtn = document.querySelector<HTMLElement>(".close-lightbox");

    if (!lightbox || !closeBtn) {
        log("warn", "Lightbox elements not found");
        return;
    }

    closeBtn.addEventListener("click", closeLightbox);

    // Background click closes the lightbox. A tap on a touch screen hides or
    // shows the bar instead (see setupGestures), like a phone's photo viewer.
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

    // Click-to-zoom on the lightbox image
    const lightboxImg = document.getElementById("lightbox-img") as HTMLImageElement | null;
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

        // Ensure the anchor has the lightbox-trigger class and media type set
        if (!anchor.classList.contains("lightbox-trigger")) {
            anchor.classList.add("lightbox-trigger");
            anchor.dataset.mediaType = videoExtensions.some((ext) => hrefLower.endsWith(ext))
                ? "video"
                : audioExtensions.some((ext) => hrefLower.endsWith(ext))
                  ? "audio"
                  : "image";
        }

        // Rebuild trigger list to include any links added after initial page load
        allTriggers = Array.from(document.querySelectorAll<HTMLAnchorElement>(".lightbox-trigger"));

        handleLightboxClick.call(anchor);
    });

    // Wire up the on-screen navigation arrows
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

    // Touch gestures (pinch-zoom, double-tap, pan, swipe) anywhere in the viewer
    if (lightboxImg) setupGestures(lightbox, lightboxImg);

    // Keyboard controls while the lightbox is open
    document.addEventListener("keydown", (event) => {
        if (!lightbox.classList.contains("is-open")) return;

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
    });
}

/**
 * Sets up touch-driven pinch-zoom, double-tap zoom, drag-to-pan, and swipe
 * navigation/close. Mouse pointers are ignored here so the desktop
 * click-to-zoom behaviour is preserved.
 *
 * Listens on the whole viewer, not the image: on a portrait phone the image is a
 * strip about a quarter of the screen tall, and gestures that only worked on it
 * meant aiming at that strip.
 */
function setupGestures(lightbox: HTMLElement, img: HTMLImageElement): void {
    const SWIPE_THRESHOLD = 50; // px before a drag counts as a swipe
    const TAP_MOVE_TOL = 12; // px of movement still treated as a tap
    const DOUBLE_TAP_MS = 300;
    const MAX_SCALE = 4;
    const DOUBLE_TAP_SCALE = 2.5;
    // Deliberate enough to mean "I want to see detail", rather than the drift of
    // a two-finger pan, before spending a request on more pixels.
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
        if (event.pointerType === "mouse") return; // desktop uses click-to-zoom
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
            // Past a deliberate pinch, fetch more pixels. No regrow — the
            // transform is doing the magnifying, so the box stays put and only
            // the source sharpens.
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

        const sx = last.x - (swipeStart ? swipeStart.x : last.x);
        const sy = last.y - (swipeStart ? swipeStart.y : last.y);
        const moved = Math.hypot(sx, sy);
        // Swipe directions are read the way the reader holds the phone. Rotated,
        // the image's top is the screen's right edge, so the reader's "down" is
        // the screen's left and their "right" is the screen's down.
        const dx = isRotated ? sy : sx;
        const dy = isRotated ? -sx : sy;

        if (moved < TAP_MOVE_TOL) {
            // Tap: a double tap toggles zoom, a single one hides or shows the
            // bar. The single tap waits out the double-tap window so a zoom
            // doesn't flicker the bar.
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
                    // Jumps straight past the pinch thresholds without ever going
                    // through pointermove, so it needs its own upgrade.
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

    lightbox.addEventListener("pointerup", endPointer);
    lightbox.addEventListener("pointercancel", endPointer);
}

document.addEventListener("DOMContentLoaded", initLightbox);

/** Warms an image on hover, so the viewer opens on it without a wait. */
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
        // Warm the copy the lightbox will actually ask for. Fetching the raw
        // href pulled the full-size master, so a phone paid several MB on the
        // touch that opens the lightbox and then downloaded the small version
        // as well — cancelling out the whole point of the size variants.
        // Resolved per event rather than once, because the answer depends on
        // viewport and DPR, and a rotate or resize changes it.
        const warm = () => loadImage(tieredUrl(imageUrl));
        aTag.addEventListener("pointerenter", warm, { once: true });
        aTag.addEventListener("click", warm, { once: true });
    });
});
