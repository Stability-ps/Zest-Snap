// "Today" home-screen widget for Zest Snap (iOS 15+). NOT part of the app target: add it as a Widget Extension in
// Xcode following docs/mobile/WIDGETS.md, then replace the template's Swift file with this one.
// Data: the snapshot the app writes to the App Group via ZestNative.setWidgetData (lib/native/widget.ts).
import SwiftUI
import WidgetKit

private let appGroup = "group.app.zestsnap"

struct WidgetItem: Decodable { let time: String; let title: String; let type: String }
struct WidgetDay: Decodable { let count: Int; let items: [WidgetItem] }
struct WidgetSnapshot: Decodable { let days: [String: WidgetDay] }

struct TodayEntry: TimelineEntry {
    let date: Date
    let day: WidgetDay?
}

private func dayKey(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
}

private func loadSnapshot() -> WidgetSnapshot? {
    guard let json = UserDefaults(suiteName: appGroup)?.string(forKey: "snapshot"), let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), day: WidgetDay(count: 2, items: [WidgetItem(time: "08:30", title: "Dentist", type: "event"), WidgetItem(time: "10:00", title: "Science Fair", type: "event")]))
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : TodayEntry(date: Date(), day: loadSnapshot()?.days[dayKey(Date())]))
    }

    /// One entry now and one at each of the next two midnights, so "Today" rolls over without opening the app.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let snapshot = loadSnapshot()
        let cal = Calendar.current
        var entries = [TodayEntry(date: Date(), day: snapshot?.days[dayKey(Date())])]
        var next = cal.startOfDay(for: Date())
        for _ in 0..<2 {
            next = cal.date(byAdding: .day, value: 1, to: next)!
            entries.append(TodayEntry(date: next, day: snapshot?.days[dayKey(next)]))
        }
        completion(Timeline(entries: entries, policy: .after(cal.date(byAdding: .minute, value: 30, to: Date())!)))
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry
    @Environment(\.widgetFamily) private var family
    private let teal = Color(red: 0, green: 198 / 255, blue: 167 / 255)
    private let navy = Color(red: 11 / 255, green: 31 / 255, blue: 59 / 255)

    var body: some View {
        let items = Array((entry.day?.items ?? []).prefix(family == .systemSmall ? 2 : 3))
        let count = entry.day?.count ?? 0
        VStack(alignment: .leading, spacing: 6) {
            let countText = Text(count == 0 ? "Nothing planned" : count == 1 ? "1 thing" : "\(count) things").font(.caption.bold()).foregroundColor(teal)
            if family == .systemSmall {
                // Small widgets are too narrow for title + count on one line.
                Text("Today").font(.headline).foregroundColor(.white)
                countText
            } else {
                HStack {
                    Text("Today").font(.headline).foregroundColor(.white)
                    Spacer()
                    countText
                }
            }
            if items.isEmpty {
                Spacer()
                Text("Your day is clear. Snap something to plan ahead.").font(.footnote).foregroundColor(.white.opacity(0.75))
                Spacer()
            } else {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 8) {
                        Text(item.time.isEmpty ? "All day" : item.time).font(.caption.bold()).foregroundColor(teal).frame(width: 52, alignment: .leading)
                        Text(item.title).font(.footnote).foregroundColor(.white).lineLimit(1)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.1)).cornerRadius(10)
                }
                if count > items.count { Text("+\(count - items.count) more").font(.caption2).foregroundColor(.white.opacity(0.7)) }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .background(LinearGradient(colors: [Color(red: 18 / 255, green: 52 / 255, blue: 92 / 255), navy], startPoint: .top, endPoint: .bottom))
        .widgetURL(URL(string: "https://app.zestsnap.app/app?view=calendar&tab=today"))
    }
}

@main
struct ZestTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ZestTodayWidget", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Your next Zest Snap items for today.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
