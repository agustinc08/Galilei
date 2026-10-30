type LineIconName = "folder" | "institution" | "lock" | "scales";

type LineIconProps = {
  name: LineIconName;
  className?: string;
};

export function LineIcon({ name, className }: LineIconProps) {
  const paths = {
    folder: <><path d="M3.75 7.25h6l1.75 2h8.75v10.5H3.75z" /><path d="M3.75 7.25V5.5h7l1.5 1.75" /></>,
    institution: <><path d="m3 9 9-5 9 5" /><path d="M4.75 9.5v9.75M9.5 9.5v9.75M14.5 9.5v9.75M19.25 9.5v9.75M3.5 20h17" /></>,
    lock: <><path d="M6.25 10.25h11.5v9.5H6.25z" /><path d="M8.5 10.25V7a3.5 3.5 0 0 1 7 0v3.25M12 14v2" /></>,
    scales: <><path d="M12 3.5v16.75M6.5 20.25h11M5.25 7.25h13.5M12 3.5l-7 3.75M12 3.5l7 3.75" /><path d="m5 7.5-3 6h6l-3-6Zm14 0-3 6h6l-3-6Z" /></>,
  }[name];

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}
