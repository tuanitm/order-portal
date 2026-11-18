/** The portal's time zone (GMT+7) — every date/time on screen is shown in it, whatever the viewer's device uses. */
export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Today's date in Vietnam as "YYYY-MM-DD". */
export function vnToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: VN_TIME_ZONE }).format(new Date());
}
