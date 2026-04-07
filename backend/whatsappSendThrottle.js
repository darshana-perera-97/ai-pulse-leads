/**
 * WhatsApp bulk-send pacing (server-side).
 * - At least 1 minute between consecutive contacts
 * - After each 10 contacts: additional 10 minutes before the next
 * - After each 100 contacts: additional 40 minutes before the next
 * Milestones stack (e.g. after contact 100: +1m base +10m +40m before 101).
 */

const MINUTE_MS = 60_000;

/**
 * Milliseconds to wait after successfully completing send #completedCount (1-based),
 * before starting the next send.
 * @param {number} completedCount
 */
function delayMsAfterCompletedSend(completedCount) {
    if (completedCount < 1) return 0;
    let ms = MINUTE_MS;
    if (completedCount % 10 === 0) ms += 10 * MINUTE_MS;
    if (completedCount % 100 === 0) ms += 40 * MINUTE_MS;
    return ms;
}

/**
 * Total throttle delay for sending `contactCount` messages in one run from the first
 * (no wait before the first send). Equivalent to sum of delays after sends 1..N-1.
 * @param {number} contactCount
 */
function totalThrottleDelayMsForContactCount(contactCount) {
    if (contactCount <= 1) return 0;
    let t = 0;
    for (let k = 1; k < contactCount; k++) {
        t += delayMsAfterCompletedSend(k);
    }
    return t;
}

/**
 * Remaining delay time if `alreadySent` contacts are done and `remainingToSend` are left.
 * @param {number} alreadySent
 * @param {number} remainingToSend
 */
function remainingThrottleDelayMs(alreadySent, remainingToSend) {
    if (remainingToSend <= 1) return 0;
    let t = 0;
    for (let j = 1; j < remainingToSend; j++) {
        t += delayMsAfterCompletedSend(alreadySent + j);
    }
    return t;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    MINUTE_MS,
    delayMsAfterCompletedSend,
    totalThrottleDelayMsForContactCount,
    remainingThrottleDelayMs,
    sleep,
};
