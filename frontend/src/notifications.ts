import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

const REMINDER_ID = "daily-reminder-bodypilot";
const REMINDER_PREF_KEY = "daily-reminder-enabled";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Requests notification permission (if needed) and schedules a daily
 * repeating local reminder at 18:00, if not already scheduled.
 * Safe to call on every app start — it's a no-op if already set up.
 */
export async function ensureDailyReminderScheduled() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      await storage.setItem(REMINDER_PREF_KEY, false);
      return false;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Rappels quotidiens",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Clear any previously scheduled reminder first, to avoid ever ending up
    // with duplicates if this gets called more than once.
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: "N'oublie pas Bodypilot 💪",
        body: "Un petit coup d'œil à ta séance ou ton suivi nutrition avant la fin de journée ?",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 18,
        minute: 0,
      },
    });
    // The saved preference is the source of truth from now on — querying the
    // OS's scheduled-notifications list directly can lag or behave
    // inconsistently across devices right after scheduling/cancelling.
    await storage.setItem(REMINDER_PREF_KEY, true);
    return true;
  } catch {
    // Notifications are a nice-to-have — never let a failure here affect the app.
    return false;
  }
}

export async function cancelDailyReminder() {
  // Always record the preference first: even if the OS-level cancellation
  // below fails or is slow, the toggle must reflect "off" immediately and
  // reliably the next time the app checks.
  await storage.setItem(REMINDER_PREF_KEY, false);
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
    // Defensive: also sweep any other scheduled notification that happens to
    // carry the same identifier/title, in case duplicates were ever created.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier === REMINDER_ID)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}))
    );
  } catch {}
}

export async function isDailyReminderEnabled(): Promise<boolean> {
  // Trust our own persisted preference as the source of truth, since it's
  // set explicitly and immediately on every toggle — more reliable than
  // re-querying the OS's scheduled-notifications list, which can be a beat
  // behind right after a schedule/cancel call on some devices.
  const pref = await storage.getItem<boolean>(REMINDER_PREF_KEY, false);
  return !!pref;
}

/**
 * For brand new accounts only: schedules the reminder by default, but ONLY
 * if the user has never made an explicit choice (on or off) before. Safe to
 * call on every app start/login — once any explicit preference exists
 * (set by the Profile toggle), this is a permanent no-op and will never
 * silently re-enable a reminder the user turned off.
 */
export async function autoScheduleReminderIfNeverSet() {
  const hasPreference = await storage.getItem<boolean | null>(REMINDER_PREF_KEY, null);
  if (hasPreference === null) {
    await ensureDailyReminderScheduled();
  }
}
