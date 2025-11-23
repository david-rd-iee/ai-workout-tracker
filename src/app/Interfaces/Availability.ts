export interface TimeWindow {
    startTime: string;
    endTime: string;
}

export interface DayAvailability {
    day: string;
    available: boolean;
    timeWindows: TimeWindow[];
}