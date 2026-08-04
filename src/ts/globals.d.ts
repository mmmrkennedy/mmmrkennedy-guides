/**
 * Ambient declarations shared across the site scripts.
 *
 * These scripts are plain (non-module) browser scripts loaded via <script defer>
 * and communicate through globals hung off `window`. This file types those
 * globals plus the data structures shared between quick-links-utils and
 * content/quick-links.
 */

/** Console methods `Log` can dispatch to. */
type LogLevel = "log" | "info" | "warn" | "error" | "debug";

/** Levels as written at the call site — "warn" and "Warn" are both accepted. */
type LogLevelInput = LogLevel | Capitalize<LogLevel>;

/** A single entry in the generated quick-links / table of contents. */
interface QuickLinkItem {
    element: HTMLElement;
    indentLevel: number;
    isSectionHeader?: boolean;
    /** 0 (number, the default) renders an <h2>; any dataset string renders an <h4>. */
    sectionHeaderLevel?: string | number;
    custom_name?: string;
}

interface PageUtilsApi {
    getCurrentPage(): string;
}

interface ScrollManagerApi {
    scrollToTop(fromPopstate?: boolean): void;
    scrollToAnchors(): void;
    scrollToElement(elementId: string, historyMode?: "push" | "replace" | "none"): void;
    restoreStampedScroll(behavior?: ScrollBehavior): boolean;
    clearHashAndScrollTop(): void;
    initHistoryManagement(): void;
}

interface LegendApi {
    initLegend(): void;
}

interface LightboxApi {
    preloadAdjacentMedia(currentIndex: number): void;
    openLightbox(mediaSrc: string, captionText: string, index: number, mediaType: string): void;
    navigateToPrevious(): void;
    navigateToNext(): void;
    closeLightbox(): void;
    handleLightboxClick(this: HTMLAnchorElement): void;
    initLightbox(): void;
}

interface AdsApi {
    initAds(): void;
    makeAdsRed(): void;
}

interface LinkProcessorApi {
    setupSolverButtons(): void;
}

interface QuickLinksApi {
    initializeQuickLinks(): void;
    generateQuickLinks(parentElement: HTMLElement, elements: QuickLinkItem[]): void;
    initializeSidebarToc(): void;
}

interface SolverButtonProcessorApi {
    initRevealButtons(): void;
}

interface PathTabsApi {
    initPathTabs(): void;
    revealPathTo(id: string): void;
}

interface QuickLinksUtilsApi {
    getElementTitle(element: HTMLElement): string;
    getQuickLinkElements(doc: Document): QuickLinkItem[];
}

interface Window {
    /** Dev-only console output; silent in production. See core/logger.ts. */
    Log: (level: LogLevelInput, ...args: unknown[]) => void;

    PageUtils: PageUtilsApi;
    ScrollManager: ScrollManagerApi;
    Legend: LegendApi;
    Lightbox: LightboxApi;
    Ads: AdsApi;
    LinkProcessor: LinkProcessorApi;
    QuickLinks: QuickLinksApi;
    SolverButtonProcessor: SolverButtonProcessorApi;
    PathTabs: PathTabsApi;
    QuickLinksUtils: QuickLinksUtilsApi;

    navigateToIndex(): void;
    isPrefetched(url: string): boolean;
    getPrefetchedUrls(): string[];

    /** AdSense queue injected by the external adsbygoogle.js loader. */
    adsbygoogle?: unknown[];
}
