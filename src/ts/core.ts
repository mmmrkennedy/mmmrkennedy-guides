/**
 * The core site bundle, loaded `defer` on every page. Scripts run in this order,
 * and most wait for DOMContentLoaded, so this is also the order they start in.
 * Page-specific features turn themselves off when their markup or body flag is absent.
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
