// A link that jumps to a part of the page. It does not change the address, which is the app's own route.
export function SkipLink({ target, label }: { target: string; label: string }) {
  return (
    <a
      className="skip-link"
      href={`#${target}`}
      onClick={(event) => {
        const element = document.getElementById(target);
        if (!element) return;
        event.preventDefault();
        element.focus();
        element.scrollIntoView({ block: 'start' });
      }}
    >
      {label}
    </a>
  );
}
