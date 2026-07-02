import { Notification } from "electron";

export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, timeoutType: "never", silent: false }).show();
}
