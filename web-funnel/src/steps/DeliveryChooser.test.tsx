import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeliveryChooser } from "./DeliveryChooser";

describe("delivery chooser", () => {
  it("defaults to manual sender delivery and saves without provider contact", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <DeliveryChooser
        recipient="Sarah"
        contentReady={false}
        automatedDeliveryEnabled
        onSave={save}
        onStopChannel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("I’ll send it")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "I’ll send it" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ delivery_mode: "manual", expires_in_days: 30 }),
      ),
    );
    expect(screen.queryByText("Recipient phone")).not.toBeInTheDocument();
  });

  it("requires an explicit choice when the server reports not requested", () => {
    render(
      <DeliveryChooser
        recipient="Sarah"
        contentReady
        deliveryStatus="not_requested"
        delivery={{ mode: "manual", revision: 0, can_edit: true }}
        onSave={vi.fn()}
        onStopChannel={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "How should Sarah receive it?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "I’ll send it" })).toBeVisible();
  });

  it("validates automated delivery only after sender ownership is chosen", async () => {
    const save = vi.fn();
    render(
      <DeliveryChooser
        recipient="Sarah"
        contentReady={false}
        automatedDeliveryEnabled
        onSave={save}
        onStopChannel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Porizo sends it"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText("Choose Text, Email, or both.")).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });

  it("stops only the selected unsent channel with explicit no-refund confirmation", () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <DeliveryChooser
        recipient="Sarah"
        contentReady
        deliveryStatus="partial"
        delivery={{
          mode: "immediate",
          channels: [
            { channel: "sms", status: "accepted", masked_destination: "+61•••42" },
            { channel: "email", status: "pending", masked_destination: "s•••@mail.test", can_stop: true },
          ],
        }}
        onSave={vi.fn()}
        onStopChannel={stop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop Email" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("No credit is returned"));
    expect(stop).toHaveBeenCalledWith("email");
    expect(screen.queryByRole("button", { name: "Stop Text" })).not.toBeInTheDocument();
    expect(screen.getByText(/Accepted by provider/)).toBeVisible();
    expect(screen.getByText(/Waiting to send/)).toBeVisible();
  });

  it("requires blank destination re-entry when changing a saved delivery", () => {
    render(
      <DeliveryChooser
        recipient="Sarah"
        contentReady={false}
        automatedDeliveryEnabled
        delivery={{
          mode: "immediate",
          revision: 7,
          can_edit: true,
          channels: [
            { channel: "email", status: "pending", masked_destination: "s•••@mail.test" },
          ],
        }}
        onSave={vi.fn()}
        onStopChannel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change delivery" }));
    fireEvent.click(screen.getByLabelText("Porizo sends it"));
    fireEvent.click(screen.getByLabelText("Email"));
    expect(screen.getByLabelText("Recipient email")).toHaveValue("");
  });
});
