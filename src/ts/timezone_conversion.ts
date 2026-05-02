function getEquivalentTimesInTimezone(timezone? :string): { equivalentTo12AMEST: string, equivalentTo1AMEST: string } {
    const isDST: number = isESTInDST();

    // Create a Date object for 12 AM EST
    const dateAt12AM = new Date();
    dateAt12AM.setUTCHours(5 - isDST, 0, 0, 0); // 12 AM EST is UTC-5

    // Create a Date object for 1 AM EST
    const dateAt1AM = new Date();
    dateAt1AM.setUTCHours(6 - isDST, 0, 0, 0); // 1 AM EST is UTC-5

    // Format the times to the specified timezone or user's local timezone
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

// Function to format the time as "12 am TZ"
function formatTime(localeString: string) {
    const [time, tzRaw] = localeString.split(" ");
    const tz = tzRaw.toUpperCase().includes("P") ? "PM" : "AM";
    const formattedTime = time.toLowerCase().replace(":00:00", ""); // Remove ":00" for cleaner output
    return `${formattedTime} ${tz}`;
}

function isESTInDST(): number {
    const timeZoneName: string = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "short",
    });

    // If it contains "EDT" instead of "EST", it's in DST
    return Number(timeZoneName.includes("EDT"));
}

document.addEventListener("DOMContentLoaded", function () {
    const userLocalTimes = getEquivalentTimesInTimezone();

    const timezone_element: HTMLElement | null = document.getElementById("timezone_conversion");

    if (!timezone_element) {
        console.error("Timezone element not found!");
        return;
    }

    const time_1: string = formatTime(userLocalTimes.equivalentTo12AMEST);
    const time_2: string = formatTime(userLocalTimes.equivalentTo1AMEST);

    if (time_1 && time_2 && !(time_1 === "12 AM" && time_2 === "1 AM")) {
        timezone_element.innerHTML = ` (the equivalent in your local time is <strong>${time_1}</strong> to <strong>${time_2}</strong>)`;
    }
});

/*
// Example usage:
const equivalentTimes = getEquivalentTimesInTimezone('Europe/London'); // Pass a timezone like 'Europe/London'
console.log('12 AM EST in the specified timezone:', equivalentTimes.equivalentTo12AMEST);
console.log('1 AM EST in the specified timezone:', equivalentTimes.equivalentTo1AMEST);

// For the user's local timezone
userLocalTimes = getEquivalentTimesInTimezone();
console.log('12 AM EST in your local timezone:', userLocalTimes.equivalentTo12AMEST);
console.log('1 AM EST in your local timezone:', userLocalTimes.equivalentTo1AMEST);
*/
