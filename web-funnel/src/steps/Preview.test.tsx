import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "./Preview";

describe("preview player", () => {
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
});
