import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlacePeek from "../PlacePeek";

describe("PlacePeek", () => {
  it("never renders a rating or review count", () => {
    render(
      <PlacePeek
        name="Niigata Katsudon Tarekatsu"
        category="eat"
        priceLevel={2}
        description="A tucked-away katsudon counter."
        placeGoogleId="ChIJgQzMFUjuGGAR6qPpl9ZyjVw"
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText("★")).toBeNull();
    expect(screen.queryByText(/review/i)).toBeNull();
  });

  it("shows a price chip only when priceLevel is non-null", () => {
    const { rerender } = render(
      <PlacePeek
        name="Corn Barley"
        category="eat"
        priceLevel={3}
        description={null}
        placeGoogleId="place-1"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("$$$")).toBeDefined();

    rerender(
      <PlacePeek
        name="Corn Barley"
        category="eat"
        priceLevel={null}
        description={null}
        placeGoogleId="place-1"
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText("$$$")).toBeNull();
  });

  it("shows a description line only when description is non-empty", () => {
    const { rerender } = render(
      <PlacePeek
        name="Inokashira Park"
        category="visit"
        priceLevel={null}
        description="A pond-centered park near the station."
        placeGoogleId="place-2"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("A pond-centered park near the station.")).toBeDefined();

    rerender(
      <PlacePeek
        name="Inokashira Park"
        category="visit"
        priceLevel={null}
        description={null}
        placeGoogleId="place-2"
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText("A pond-centered park near the station.")).toBeNull();
  });

  it("always shows an unconditional hours-unknown chip", () => {
    render(
      <PlacePeek
        name="Sakana -io-"
        category="eat"
        priceLevel={null}
        description={null}
        placeGoogleId="place-3"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Hours unknown")).toBeDefined();
  });

  it("links to the correct Google Maps place URL", () => {
    render(
      <PlacePeek
        name="Sakana -io-"
        category="eat"
        priceLevel={null}
        description={null}
        placeGoogleId="ChIJabc123"
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: /Open in Google Maps/i });
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/place/?q=place_id:ChIJabc123");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("calls onClose when a click lands outside the peek", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <PlacePeek
          name="Sakana -io-"
          category="eat"
          priceLevel={null}
          description={null}
          placeGoogleId="place-3"
          onClose={onClose}
        />
      </div>
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", async () => {
    const onClose = vi.fn();
    render(
      <PlacePeek
        name="Sakana -io-"
        category="eat"
        priceLevel={null}
        description={null}
        placeGoogleId="place-3"
        onClose={onClose}
      />
    );
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for a click inside the peek", async () => {
    const onClose = vi.fn();
    render(
      <PlacePeek
        name="Sakana -io-"
        category="eat"
        priceLevel={2}
        description={null}
        placeGoogleId="place-3"
        onClose={onClose}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Sakana -io-"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
