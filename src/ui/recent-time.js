/** Concise local timestamps for Markpad's Recent Files & Drafts dialog. */
export function formatRecentTime(value, now = new Date()) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return 'Unknown date';
  const current=new Date(now);
  const threshold=new Date(current);
  threshold.setMonth(threshold.getMonth()-6);
  const older=date<threshold;
  const month=new Intl.DateTimeFormat('en-US',{month:'short'}).format(date);
  const hour=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',hour12:true}).format(date);
  return `${older?`'${String(date.getFullYear()).slice(-2)} `:''}${month} ${date.getDate()} · ${hour}`;
}
