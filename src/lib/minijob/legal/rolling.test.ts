import { describe, expect, it } from "vitest";
import {
  addMonths,
  evaluateRolling12Months,
  forecastMonth,
  forecastRolling12Months,
  rolling12Months,
} from "./rolling";

describe("rolling 12-month legal engine", () => {
  it("builds exactly 12 calendar months and includes the anchor month", () => {
    const result = rolling12Months(
      [{ date: "2026-09-18", earnings: 100 }],
      "2026-09-20",
    );
    expect(result).toHaveLength(12);
    expect(result[0]?.date).toBe("2025-10-01");
    expect(result[11]?.date).toBe("2026-09-01");
    expect(result[11]?.earnings).toBe(100);
  });

  it("aggregates duplicate income records for the same month", () => {
    const result = rolling12Months(
      [
        { date: "2026-09-01", earnings: 400 },
        { date: "2026-09-15", earnings: 203 },
      ],
      "2026-09-30",
    );
    expect(result[11]?.earnings).toBe(603);
  });

  it("drops months outside the rolling window", () => {
    const result = rolling12Months(
      [
        { date: "2025-09-01", earnings: 999 },
        { date: "2025-10-01", earnings: 100 },
      ],
      "2026-09-01",
    );
    expect(result[0]?.date).toBe("2025-10-01");
    expect(result[0]?.earnings).toBe(100);
  });

  it("calculates the 2026 regular rolling limit", () => {
    const result = evaluateRolling12Months(
      Array.from({ length: 12 }, (_, i) => ({
        date: addMonths("2026-09-01", i - 11),
        earnings: 603,
        unpredictable: false,
      })),
      "2026-09-01",
    );
    expect(result.regularLimit).toBe(7236);
    expect(result.earnings).toBe(7236);
    expect(result.allowed).toBe(true);
  });

  it("allows two documented unpredictable months in the rolling window", () => {
    const incomes = Array.from({ length: 12 }, (_, i) => ({
      date: addMonths("2026-09-01", i - 11),
      earnings: 603,
      unpredictable: false,
    }));
    incomes[2]!.earnings = 1206;
    incomes[2]!.unpredictable = true;
    incomes[8]!.earnings = 1206;
    incomes[8]!.unpredictable = true;

    const result = evaluateRolling12Months(incomes, "2026-09-01");
    expect(result.unpredictableMonths).toBe(2);
    expect(result.maximumAllowedIncome).toBe(8442);
    expect(result.allowed).toBe(true);
  });

  it("rejects a third documented unpredictable month", () => {
    const incomes = Array.from({ length: 12 }, (_, i) => ({
      date: addMonths("2026-09-01", i - 11),
      earnings: 603,
      unpredictable: i < 3,
    }));
    incomes[0]!.earnings = 1206;
    incomes[1]!.earnings = 1206;
    incomes[2]!.earnings = 1206;

    const result = evaluateRolling12Months(incomes, "2026-09-01");
    expect(result.unpredictableMonths).toBe(3);
    expect(result.allowed).toBe(false);
  });

  it("forecasts actual plus expected income without mutating actuals", () => {
    const result = forecastMonth("2026-09-10", {
      actual: 500,
      expectedAdditional: 150,
    });
    expect(result.actual).toBe(500);
    expect(result.projected).toBe(650);
    expect(result.limit).toBe(603);
    expect(result.exceedsRegularLimit).toBe(true);
    expect(result.exceedsMaximumUnpredictableLimit).toBe(false);
  });

  it("warns when future work pushes the rolling window over the legal envelope", () => {
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      date: addMonths("2026-09-01", i - 11),
      actual: 603,
      expectedAdditional: 0,
      unpredictable: false,
    }));
    inputs[11]!.actual = 500;
    inputs[11]!.expectedAdditional = 150;

    const result = forecastRolling12Months(inputs, "2026-09-01");
    expect(result.projectedEarnings).toBe(7386);
    expect(result.exceedsRegularLimit).toBe(true);
    expect(result.exceedsMaximumAllowedIncome).toBe(true);
  });
});
