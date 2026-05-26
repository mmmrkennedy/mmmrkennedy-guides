/**
 * Tutorial system for first-time users
 * Handles tutorial popup, navigation, and progress tracking
 */

// Tutorial disabled pending rework — set to true to re-enable.
const TUTORIAL_ENABLED = false;

/**
 * Checks if current page is the index page
 */
function isIndexPage() {
    // Check multiple ways to determine if we're on index
    const path = window.location.pathname;

    // Common index page patterns
    return path === "/" || path === "/index.html" || path === "/index.htm" || path.endsWith("/") || path === "";
}

/**
 * Initializes tutorial popup for first-time users
 */
function tutorialPopupInit() {
    if (!TUTORIAL_ENABLED) return;

    if (!isIndexPage()) return;

    if (!localStorage.getItem("zombiesGuidesTutorialShown")) {
        initTutorial();
        setTimeout(showTutorial, 800);
    }
}

let currentPage = 1;

/**
 * Initializes tutorial event listeners and shows first page
 */
function initTutorial() {
    const tutorialOverlay = document.getElementById("tutorialOverlay");
    if (tutorialOverlay) {
        tutorialOverlay.style.display = "flex";
    }

    // Set up event listeners
    document.getElementById("prevPageBtn").addEventListener("click", navigatePrevPage);
    document.getElementById("nextPageBtn").addEventListener("click", navigateNextPage);
    document.getElementById("finishBtn").addEventListener("click", finishTutorial);
    document.getElementById("exitBtn").addEventListener("click", exitTutorial);
    document.getElementById("confirmYesBtn").addEventListener("click", finishTutorial);
    document.getElementById("confirmNoBtn").addEventListener("click", hideConfirm);
    tutorialOverlay.addEventListener("click", (e) => {
        if (e.target === tutorialOverlay) exitTutorial();
    });

    // Show first page
    showPage(1);
}

/**
 * Shows the tutorial overlay
 */
function showTutorial() {
    const overlay = document.getElementById("tutorialOverlay");
    if (overlay) {
        overlay.style.display = "flex";
    }
}

/**
 * Shows a specific tutorial page
 */
function showPage(pageNum) {
    const pages = document.querySelectorAll(".tutorial-page");
    const totalPages = pages.length;
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    const finishBtn = document.getElementById("finishBtn");

    currentPage = pageNum;

    // Hide all pages
    pages.forEach((page) => {
        page.classList.remove("active");
    });

    // Show the selected page
    const targetPage = document.querySelector(`.tutorial-page[data-page="${pageNum}"]`);
    if (targetPage) {
        targetPage.classList.add("active");
    }

    // Update button states
    prevBtn.disabled = pageNum === 1;

    // Handle last page differently
    if (pageNum === totalPages) {
        nextBtn.style.display = "none";
        finishBtn.style.display = "block";
    } else {
        nextBtn.style.display = "block";
        finishBtn.style.display = "none";
    }

    // Update progress bar
    updateProgressBar(pageNum, totalPages);
}

/**
 * Navigates to the next tutorial page
 */
function navigateNextPage() {
    showPage(currentPage + 1);
}

/**
 * Navigates to the previous tutorial page
 */
function navigatePrevPage() {
    if (currentPage > 1) {
        showPage(currentPage - 1);
    }
}

/**
 * Shows the confirm overlay — used by the exit button and overlay click
 */
function exitTutorial() {
    document.getElementById("tutorialConfirm").classList.add("active");
}

/**
 * Hides the confirm overlay
 */
function hideConfirm() {
    document.getElementById("tutorialConfirm").classList.remove("active");
}

/**
 * Finishes the tutorial and marks it as shown
 */
function finishTutorial() {
    const overlay = document.getElementById("tutorialOverlay");
    if (overlay) {
        overlay.style.display = "none";
    }
    localStorage.setItem("zombiesGuidesTutorialShown", "true");
}

/**
 * Updates the tutorial progress bar
 */
function updateProgressBar(currentPage, totalPages) {
    const progressFill = document.getElementById("progressFill");
    const progressText = document.getElementById("progressText");

    if (progressFill && progressText) {
        const progressPercentage = (currentPage / totalPages) * 100;
        progressFill.style.width = `${progressPercentage}%`;
        progressText.textContent = `Page ${currentPage} of ${totalPages}`;
    }
}

/**
 * Resets tutorial (for debugging/testing)
 * Run window.TutorialSystem.resetTutorial() in browser console to call
 */
function resetTutorial() {
    // console.log("Manually Reset Tutorial...");
    localStorage.removeItem("zombiesGuidesTutorialShown");
    window.location.reload();
}

// Make functions available globally
window.TutorialSystem = {
    isIndexPage,
    tutorialPopupInit,
    initTutorial,
    showTutorial,
    showPage,
    navigateNextPage,
    navigatePrevPage,
    exitTutorial,
    finishTutorial,
    updateProgressBar,
    resetTutorial,
};
