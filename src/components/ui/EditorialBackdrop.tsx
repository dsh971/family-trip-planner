// Decorative grid-texture + glow/blob background, extracted from Home's
// hero (src/app/page.tsx lines 222-240) into a shared piece so other
// trip-flow pages can carry the same illustrated chrome. See the
// "Editorial backdrop" comment block in globals.css for the full rationale
// behind each variant's color choices.
//
// Purely decorative (aria-hidden) and absolutely positioned with a
// negative z-index — drop it as the first child inside any `position:
// relative` (or `fixed`) container and it paints behind that container's
// other content without needing any DOM changes beyond this one element.
export default function EditorialBackdrop({ variant }: { variant: "dark" | "light" }) {
  return (
    <div aria-hidden="true" className="editorial-backdrop">
      <div className={`editorial-bg-grid editorial-bg-grid-${variant}`} />
      {variant === "dark" && <div className="editorial-bg-glow-dark" />}
      {variant === "light" && (
        <>
          <div className="editorial-bg-blob editorial-bg-blob-sage" />
          <div className="editorial-bg-blob editorial-bg-blob-tan" />
        </>
      )}
    </div>
  );
}
