import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Preview } from "./Preview";

function setPlayback(audio: HTMLAudioElement, currentTime: number, duration: number) {
  Object.defineProperties(audio, {
    currentTime: { configurable: true, value: currentTime },
    duration: { configurable: true, value: duration },
  });
  fireEvent.timeUpdate(audio);
}

describe("preview player", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--t-manual-scroll");
    vi.restoreAllMocks();
  });

  it("does not begin playback until the user presses play", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(
      <Preview
        recipient="Sarah"
        lines={["First line", "Second line"]}
        previewUrl="/preview.m4a"
        generations={1}
        onChangeLyrics={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );

    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play preview" }));
    expect(play).toHaveBeenCalledOnce();
    play.mockRestore();
  });

  it("keeps lyric editing available until the free-preview cap", () => {
    const onChangeLyrics = vi.fn();
    const { rerender } = render(
      <Preview
        recipient="Sarah"
        lines={["First line"]}
        previewUrl="/preview.m4a"
        generations={1}
        onChangeLyrics={onChangeLyrics}
        onUnlock={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change something in the lyrics" }));
    expect(onChangeLyrics).toHaveBeenCalledOnce();

    rerender(
      <Preview
        recipient="Sarah"
        lines={["First line"]}
        previewUrl="/preview.m4a"
        generations={2}
        onChangeLyrics={onChangeLyrics}
        onUnlock={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Change something in the lyrics" })).toBeNull();
  });

  it("shows a recoverable message when playback fails", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new Error("demux"))
      .mockResolvedValueOnce();
    render(
      <Preview
        recipient="Sarah"
        lines={["First line"]}
        previewUrl="/broken-preview.m4a"
        generations={1}
        onChangeLyrics={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play preview" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The preview didn't play");
    fireEvent.click(screen.getByRole("button", { name: "Try preview again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Pause preview" })).toBeVisible();
    play.mockRestore();
  });

  it("shows elapsed and total timecodes and resets them for a new source", () => {
    const props = {
      recipient: "Sarah",
      lines: ["First line", "Second line"],
      generations: 1,
      onChangeLyrics: vi.fn(),
      onUnlock: vi.fn(),
    };
    const { container, rerender } = render(<Preview {...props} previewUrl="/first.m4a" />);
    const audio = container.querySelector("audio")!;

    setPlayback(audio, 7, 21);
    expect(screen.getByText("0:07")).toBeVisible();
    expect(screen.getByText("0:21")).toBeVisible();

    rerender(<Preview {...props} previewUrl="/second.m4a" />);
    expect(within(screen.getByLabelText("Preview timecode")).getAllByText("0:00")).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: "Preview playback position" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows total duration as soon as metadata loads", () => {
    const { container } = render(
      <Preview
        recipient="Sarah"
        lines={["First line"]}
        previewUrl="/preview.m4a"
        generations={1}
        onChangeLyrics={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 21 });
    fireEvent.loadedMetadata(audio);

    expect(screen.getByText("0:21")).toBeVisible();
  });

  it("suppresses lyric auto-scroll for four seconds after manual scrolling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00Z"));
    document.documentElement.style.setProperty("--t-manual-scroll", "4s");
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = render(
      <Preview
        recipient="Sarah"
        lines={["One", "Two", "Three", "Four"]}
        previewUrl="/preview.m4a"
        generations={1}
        onChangeLyrics={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const audio = container.querySelector("audio")!;
    const lyrics = screen.getByLabelText("Song lyrics");
    scrollIntoView.mockClear();

    fireEvent.scroll(lyrics);
    setPlayback(audio, 3, 12);
    expect(scrollIntoView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);
    setPlayback(audio, 6, 12);
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("pulses the unlock action after the second completed listen", () => {
    const { container } = render(
      <Preview
        recipient="Sarah"
        lines={["First line"]}
        previewUrl="/preview.m4a"
        generations={1}
        onChangeLyrics={vi.fn()}
        onUnlock={vi.fn()}
      />,
    );
    const audio = container.querySelector("audio")!;
    const unlock = screen.getByRole("button", { name: "Unlock the full song" });

    fireEvent.play(audio);
    fireEvent.ended(audio);
    expect(unlock).not.toHaveClass("pulse-once");
    fireEvent.play(audio);
    fireEvent.ended(audio);
    expect(unlock).toHaveClass("pulse-once");
  });
});
