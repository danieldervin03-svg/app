import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const REMINDER_ID = "daily-reminder-bodypilot";

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
    if (finalStatus !== "granted") return false;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Rappels quotidiens",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const already = scheduled.some((n) => n.identifier === REMINDER_ID);
    if (already) return true;

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
    return true;
  } catch {
    // Notifications are a nice-to-have — never let a failure here affect the app.
    return false;
  }
}

export async function cancelDailyReminder() {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {}
}

export async function isDailyReminderEnabled(): Promise<boolean> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some((n) => n.identifier === REMINDER_ID);
  } catch {
    return false;
  }
}
