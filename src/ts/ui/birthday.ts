/**
 * Client-side so the anniversary shows without a deploy that day, on the reader's
 * own date. data-birthday is filled by the build from release-dates.json.
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
    if (age < 1) return;

    const slot = banner.querySelector<HTMLElement>(".site-birthday__age");
    if (slot) slot.textContent = ordinal(age);
    banner.hidden = false;

    function ordinal(n: number): string {
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
