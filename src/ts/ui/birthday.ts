/**
 * Site birthday
 * -------------
 * Unhides the home page's birthday line on the anniversary of the first guide
 * going up, and fills in how old the site turned.
 *
 * The date comes from the page (`data-birthday`), which the build fills from
 * release-dates.json, the same data behind every guide's "Initial release"
 * footer, so this can't drift from it.
 *
 * Client-side rather than baked in at build time for two reasons: a static build
 * only knows the date it was deployed, so an anniversary with no deploy that day
 * would pass unmarked; and the greeting should land on the reader's own July 29,
 * not the build server's.
 *
 * Hidden by default, so a reader without JS sees nothing rather than a stale
 * greeting on the wrong day.
 */
document.addEventListener("DOMContentLoaded", () => {
    const banner = document.querySelector<HTMLElement>(".site-birthday[data-birthday]");
    if (!banner) return;

    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(banner.dataset.birthday ?? "");
    if (!parts) return; // no release data in the build, so stay hidden

    const birthYear = Number(parts[1]);
    const birthMonth = Number(parts[2]);
    const birthDay = Number(parts[3]);

    const today = new Date();
    if (today.getMonth() + 1 !== birthMonth || today.getDate() !== birthDay) return;

    const age = today.getFullYear() - birthYear;
    if (age < 1) return; // the launch day itself isn't a birthday

    const slot = banner.querySelector<HTMLElement>(".site-birthday__age");
    if (slot) slot.textContent = ordinal(age);
    banner.hidden = false;

    /** 1 -> "1st", 3 -> "3rd", 11 -> "11th". */
    function ordinal(n: number): string {
        // The teens all take "th" regardless of their last digit.
        const teens = n % 100;
        if (teens >= 11 && teens <= 13) return `${n}th`;

        switch (n % 10) {
            case 1:
                return `${n}st`;
            case 2:
                return `${n}nd`;
            case 3:
                return `${n}rd`;
            default:
                return `${n}th`;
        }
    }
});
