import Foundation
import HealthKit

struct HealthMetricDisplay: Identifiable {
    let id: String
    let title: String
    let icon: String
}

let healthMetricDisplays: [HealthMetricDisplay] = [
    .init(id: "sleep", title: "Sleep", icon: "bed.double.fill"),
    .init(id: "heart_rate", title: "Heart rate", icon: "heart.fill"),
    .init(id: "blood_pressure", title: "Blood pressure", icon: "waveform.path.ecg"),
    .init(id: "steps", title: "Steps", icon: "figure.walk"),
    .init(id: "active_energy", title: "Active energy", icon: "flame.fill"),
    .init(id: "exercise_minutes", title: "Exercise minutes", icon: "figure.run"),
    .init(id: "stand_hours", title: "Stand time", icon: "figure.stand"),
    .init(id: "workout", title: "Workouts", icon: "dumbbell.fill"),
    .init(id: "resting_heart_rate", title: "Resting heart rate", icon: "heart.circle"),
    .init(id: "hrv", title: "Heart rate variability", icon: "waveform.path"),
    .init(id: "respiratory_rate", title: "Respiratory rate", icon: "lungs.fill"),
    .init(id: "oxygen_saturation", title: "Blood oxygen", icon: "drop.fill"),
    .init(id: "body_mass", title: "Weight", icon: "scalemass.fill"),
    .init(id: "body_fat", title: "Body fat", icon: "percent"),
    .init(id: "distance", title: "Walking + running distance", icon: "map.fill"),
]

struct SleepSyncStatus: Codable {
    var authorized = false
    var syncing = false
    var lastSync: Date?
    var message = "Not configured"
    var lastChanges: [String: Int] = [:]
    var latestByKind: [String: Date] = [:]
    var historyBeforeByKind: [String: Date] = [:]
    var historyCompleteByKind: [String: Bool] = [:]
    var serverMetrics: [HealthServerMetric] = []
    var canonicalSleep: CanonicalSleepStatus?
}

private struct QuantityDefinition {
    let key: String
    let kind: String
    let identifier: HKQuantityTypeIdentifier
    let unit: HKUnit
    let valueKey: String
}

@MainActor
final class HealthKitSleepSync: ObservableObject {
    static let shared = HealthKitSleepSync()
    @Published private(set) var status: SleepSyncStatus
    private let store = HKHealthStore()
    private let defaultsKey = "hyper.health.sync.status.v4"
    private let anchorPrefix = "hyper.health.fresh.anchor."
    private let historyPrefix = "hyper.health.history.before."
    private let currentSyncVersion = 4
    private let syncVersionKey = "hyper.health.sync.version"

    private let quantities: [QuantityDefinition] = [
        .init(key: "heart_rate", kind: "heart_rate", identifier: .heartRate, unit: HKUnit.count().unitDivided(by: .minute()), valueKey: "bpm"),
        .init(key: "steps", kind: "steps", identifier: .stepCount, unit: .count(), valueKey: "count"),
        .init(key: "active_energy", kind: "active_energy", identifier: .activeEnergyBurned, unit: .kilocalorie(), valueKey: "kilocalories"),
        .init(key: "exercise_minutes", kind: "exercise_minutes", identifier: .appleExerciseTime, unit: .minute(), valueKey: "minutes"),
        .init(key: "stand_hours", kind: "stand_hours", identifier: .appleStandTime, unit: .minute(), valueKey: "minutes"),
        .init(key: "resting_heart_rate", kind: "resting_heart_rate", identifier: .restingHeartRate, unit: HKUnit.count().unitDivided(by: .minute()), valueKey: "bpm"),
        .init(key: "hrv", kind: "hrv", identifier: .heartRateVariabilitySDNN, unit: HKUnit.secondUnit(with: .milli), valueKey: "milliseconds"),
        .init(key: "respiratory_rate", kind: "respiratory_rate", identifier: .respiratoryRate, unit: HKUnit.count().unitDivided(by: .minute()), valueKey: "breathsPerMinute"),
        .init(key: "oxygen_saturation", kind: "oxygen_saturation", identifier: .oxygenSaturation, unit: .percent(), valueKey: "fraction"),
        .init(key: "body_mass", kind: "body_mass", identifier: .bodyMass, unit: HKUnit.gramUnit(with: .kilo), valueKey: "kilograms"),
        .init(key: "body_fat", kind: "body_fat", identifier: .bodyFatPercentage, unit: .percent(), valueKey: "fraction"),
        .init(key: "distance", kind: "distance", identifier: .distanceWalkingRunning, unit: HKUnit.meterUnit(with: .kilo), valueKey: "kilometers"),
    ]

    private init() {
        if let data = UserDefaults.standard.data(forKey: defaultsKey), let decoded = try? JSONDecoder().decode(SleepSyncStatus.self, from: data) { status = decoded }
        else { status = SleepSyncStatus() }
        status.syncing = false
        if UserDefaults.standard.integer(forKey: syncVersionKey) < currentSyncVersion {
            allCursorKeys.forEach {
                UserDefaults.standard.removeObject(forKey: anchorPrefix + $0)
                UserDefaults.standard.removeObject(forKey: historyPrefix + $0)
            }
            status.historyCompleteByKind = [:]
            UserDefaults.standard.set(currentSyncVersion, forKey: syncVersionKey)
            save()
        }
    }

    func requestAndSync(baseURL: URL) async {
        guard HKHealthStore.isHealthDataAvailable() else { setMessage("Health data unavailable"); return }
        do {
            try await store.requestAuthorization(toShare: [], read: healthTypes)
            status.authorized = true
            save()
            await sync(baseURL: baseURL)
        } catch { setMessage(error.localizedDescription) }
    }

    func syncIfAuthorized(baseURL: URL) async {
        guard status.authorized else { await refreshServerStatus(baseURL); return }
        await sync(baseURL: baseURL)
    }

    func sync(baseURL: URL) async {
        guard !status.syncing else { return }
        status.syncing = true
        status.message = "Checking fresh data…"
        save()
        defer { status.syncing = false; save() }
        do {
            var changes: [String: Int] = [:]
            try await syncFresh(type: HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!, key: "sleep", kind: "sleep", transform: categoryUpload, baseURL: baseURL, changes: &changes)
            for definition in quantities {
                let type = HKObjectType.quantityType(forIdentifier: definition.identifier)!
                try await syncFresh(type: type, key: definition.key, kind: definition.kind, transform: { self.quantityUpload($0, definition) }, baseURL: baseURL, changes: &changes)
            }
            try await syncFresh(type: HKObjectType.correlationType(forIdentifier: .bloodPressure)!, key: "blood_pressure", kind: "blood_pressure", transform: pressureUpload, baseURL: baseURL, changes: &changes)
            try await syncFresh(type: HKObjectType.workoutType(), key: "workout", kind: "workout", transform: workoutUpload, baseURL: baseURL, changes: &changes)
            status.lastChanges = changes
            status.lastSync = Date()
            let total = changes.values.reduce(0, +)
            status.message = total == 0 ? "Fresh data up to date" : "Synced \(total) fresh changes"
            save()
            await runHistoryBudget(baseURL: baseURL)
            await refreshServerStatus(baseURL)
        } catch {
            status.message = error.localizedDescription
        }
    }

    func refreshServerStatus(_ baseURL: URL) async {
        do {
            let server = try await APIClient(baseURL: baseURL).healthStatus()
            status.serverMetrics = server.metrics
            status.canonicalSleep = server.canonicalSleep
            save()
        } catch { if status.message == "Not configured" { setMessage(error.localizedDescription) } }
    }

    private func syncFresh(type: HKSampleType, key: String, kind: String, transform: (HKSample) -> HealthSampleUpload?, baseURL: URL, changes: inout [String: Int]) async throws {
        let existingAnchor = loadAnchor(key)
        let predicate = existingAnchor == nil ? HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-3 * 86400), end: Date()) : nil
        let page = try await anchored(type: type, predicate: predicate, anchor: existingAnchor)
        let uploads = page.samples.compactMap(transform)
        changes[kind] = try await upload(kind: kind, samples: uploads, baseURL: baseURL)
        if let latest = uploads.map(\.recordedAt).max() { status.latestByKind[kind] = latest }
        saveAnchor(page.anchor, key)
    }

    private func runHistoryBudget(baseURL: URL) async {
        let deadline = Date().addingTimeInterval(18)
        let jobs: [(HKSampleType, String, String, (HKSample) -> HealthSampleUpload?)] =
            [(HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!, "sleep", "sleep", categoryUpload)] +
            quantities.map { definition in (HKObjectType.quantityType(forIdentifier: definition.identifier)!, definition.key, definition.kind, { self.quantityUpload($0, definition) }) } +
            [(HKObjectType.correlationType(forIdentifier: .bloodPressure)!, "blood_pressure", "blood_pressure", pressureUpload),
             (HKObjectType.workoutType(), "workout", "workout", workoutUpload)]
        for (type, key, kind, transform) in jobs where Date() < deadline && status.historyCompleteByKind[key] != true {
            do { try await historyPage(type: type, key: key, kind: kind, transform: transform, baseURL: baseURL) }
            catch { continue }
        }
    }

    private func historyPage(type: HKSampleType, key: String, kind: String, transform: (HKSample) -> HealthSampleUpload?, baseURL: URL) async throws {
        let before = UserDefaults.standard.object(forKey: historyPrefix + key) as? Date ?? Date().addingTimeInterval(-3 * 86400)
        let predicate = HKQuery.predicateForSamples(withStart: nil, end: before, options: [.strictEndDate])
        let descriptor = HKSampleQueryDescriptor(predicates: [.sample(type: type, predicate: predicate)], sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)], limit: 500)
        let results = try await descriptor.result(for: store)
        guard !results.isEmpty else { status.historyCompleteByKind[key] = true; save(); return }
        _ = try await upload(kind: kind, samples: results.compactMap(transform), baseURL: baseURL)
        if let oldest = results.map(\.startDate).min() {
            let cursor = oldest.addingTimeInterval(-0.001)
            UserDefaults.standard.set(cursor, forKey: historyPrefix + key)
            status.historyBeforeByKind[key] = cursor
            save()
        }
    }

    private func anchored(type: HKSampleType, predicate: NSPredicate?, anchor: HKQueryAnchor?) async throws -> (samples: [HKSample], anchor: HKQueryAnchor) {
        try await withCheckedThrowingContinuation { continuation in
            store.execute(HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: HKObjectQueryNoLimit) { _, samples, _, next, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples ?? [], next ?? anchor ?? HKQueryAnchor(fromValue: 0))) }
            })
        }
    }

    private func categoryUpload(_ raw: HKSample) -> HealthSampleUpload? {
        guard let sample = raw as? HKCategorySample else { return nil }
        return .init(id: sample.uuid.uuidString, recordedAt: sample.startDate, startAt: sample.startDate, endAt: sample.endDate, value: ["category": Double(sample.value)], source: sample.sourceRevision.source.name)
    }
    private func quantityUpload(_ raw: HKSample, _ definition: QuantityDefinition) -> HealthSampleUpload? {
        guard let sample = raw as? HKQuantitySample else { return nil }
        return .init(id: sample.uuid.uuidString, recordedAt: sample.startDate, startAt: sample.startDate, endAt: sample.endDate, value: [definition.valueKey: sample.quantity.doubleValue(for: definition.unit)], source: sample.sourceRevision.source.name)
    }
    private func pressureUpload(_ raw: HKSample) -> HealthSampleUpload? {
        guard let sample = raw as? HKCorrelation, let sysType = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic), let diaType = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic), let sys = sample.objects(for: sysType).compactMap({ $0 as? HKQuantitySample }).first, let dia = sample.objects(for: diaType).compactMap({ $0 as? HKQuantitySample }).first else { return nil }
        let unit = HKUnit.millimeterOfMercury()
        return .init(id: sample.uuid.uuidString, recordedAt: sample.startDate, startAt: sample.startDate, endAt: sample.endDate, value: ["systolic": sys.quantity.doubleValue(for: unit), "diastolic": dia.quantity.doubleValue(for: unit)], source: sample.sourceRevision.source.name)
    }
    private func workoutUpload(_ raw: HKSample) -> HealthSampleUpload? {
        guard let workout = raw as? HKWorkout else { return nil }
        var values = ["activityType": Double(workout.workoutActivityType.rawValue), "durationMinutes": workout.duration / 60]
        if let energy = workout.totalEnergyBurned { values["kilocalories"] = energy.doubleValue(for: .kilocalorie()) }
        if let distance = workout.totalDistance { values["kilometers"] = distance.doubleValue(for: HKUnit.meterUnit(with: .kilo)) }
        return .init(id: workout.uuid.uuidString, recordedAt: workout.startDate, startAt: workout.startDate, endAt: workout.endDate, value: values, source: workout.sourceRevision.source.name)
    }

    private func upload(kind: String, samples: [HealthSampleUpload], baseURL: URL) async throws -> Int {
        guard !samples.isEmpty else { return 0 }
        var total = 0
        for index in stride(from: 0, to: samples.count, by: 500) {
            let result = try await APIClient(baseURL: baseURL).syncHealthSamples(kind: kind, samples: Array(samples[index..<min(index + 500, samples.count)]))
            total += result.inserted + result.updated
        }
        return total
    }

    private var healthTypes: Set<HKObjectType> {
        var result = Set<HKObjectType>()
        result.insert(HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!)
        quantities.forEach { result.insert(HKObjectType.quantityType(forIdentifier: $0.identifier)!) }
        result.insert(HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic)!)
        result.insert(HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic)!)
        result.insert(HKObjectType.workoutType())
        return result
    }
    private var allCursorKeys: [String] { ["sleep", "blood_pressure", "workout"] + quantities.map(\.key) }
    private func loadAnchor(_ key: String) -> HKQueryAnchor? { guard let data = UserDefaults.standard.data(forKey: anchorPrefix + key) else { return nil }; return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data) }
    private func saveAnchor(_ anchor: HKQueryAnchor, _ key: String) { if let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) { UserDefaults.standard.set(data, forKey: anchorPrefix + key) } }
    private func setMessage(_ message: String) { status.message = message; save() }
    private func save() { var persisted = status; persisted.syncing = false; if let data = try? JSONEncoder().encode(persisted) { UserDefaults.standard.set(data, forKey: defaultsKey) } }
}
