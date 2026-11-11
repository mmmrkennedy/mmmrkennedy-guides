import { log } from "./core/logger";

function getEquivalentTimesInTimezone(timezone? :string): { equivalentTo12AMEST: string, equivalentTo1AMEST: string } {
    const isDST: number = isESTInDST();

    // EST is UTC-5
    const dateAt12AM = new Date();
    dateAt12AM.setUTCHours(5 - isDST, 0, 0, 0);

    const dateAt1AM = new Date();
    dateAt1AM.setUTCHours(6 - isDST, 0, 0, 0);

    const options: Intl.DateTimeFormatOptions = {
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        timeZoneName: "short",
    };
    if (timezone) {
        options.timeZone = timezone;
    }

    const equivalentTo12AMEST: string = dateAt12AM.toLocaleString(undefined, options);
    const equivalentTo1AMEST: string = dateAt1AM.toLocaleString(undefined, options);

    return {
        equivalentTo12AMEST,
        equivalentTo1AMEST,
    };
}

function formatTime(localeString: string) {
    const [time, tzRaw] = localeString.split(" ");
    const tz = tzRaw.toUpperCase().includes("P") ? "PM" : "AM";
    const formattedTime = time.toLowerCase().replace(":00:00", "");
    return `${formattedTime} ${tz}`;
}

function isESTInDST(): number {
    const timeZoneName: string = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "short",
    });

    return Number(timeZoneName.includes("EDT"));
}

document.addEventListener("DOMContentLoaded", function () {
    const userLocalTimes = getEquivalentTimesInTimezone();

    const timezone_element: HTMLElement | null = document.getElementById("timezone_conversion");

    if (!timezone_element) {
        log("error", "Timezone element not found!");
        return;
    }

    const time_1: string = formatTime(userLocalTimes.equivalentTo12AMEST);
    const time_2: string = formatTime(userLocalTimes.equivalentTo1AMEST);

    if (time_1 && time_2 && !(time_1 === "12 AM" && time_2 === "1 AM")) {
        timezone_element.innerHTML = ` (the equivalent in your local time is <strong>${time_1}</strong> to <strong>${time_2}</strong>)`;
    }
});
