/**
 * Import order is the order features start in, since most wait for DOMContentLoaded.
 */
import "./navigation/scroll-manager";
// Ahead of the rest: a deep link into a collapsed path has to open that path
// before the browser scrolls the target into view.
import "./content/guide-controls";
import "./ui/legend";
import "./content/quick-links";
import "./ui/lightbox";
import "./ui/footer";
import "./ui/line-flagger";
import "./ui/reading";
import "./ui/trending";
import "./ui/stats";
import "./ui/return-pill";
import "./ui/accent-picker";
