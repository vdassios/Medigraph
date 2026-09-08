import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { FileRouteErrorCode } from '../io/fileRouter';
import type { MedigraphReadError } from '../io/fileFormat';

/**
 * Every word the product says, in both languages it says them in.
 *
 * One table, not one per component: copy bound by D13 has to be reviewable as
 * a whole, and a string invented inside a component is a string nobody reads
 * again. `Copy` is inferred from the Greek table, so a key added there and not
 * translated is a type error rather than a blank on someone's screen.
 *
 * **Greek is the source language.** The product is for Greek laboratory
 * documents; English exists because the marker registry carries `en` names and
 * a reader may prefer them. The initial choice follows `navigator.language`
 * and the toggle is stored in `localStorage` — a language preference is not
 * medical data, and it is the only thing this product keeps there.
 *
 * D13 binds every string here, in both languages: no severity, no clinical
 * inference, no direction over time, and no marketing claim beyond capability.
 * `i18n.test.ts` reads the tables and enforces it.
 */

export type Language = 'el' | 'en';

export const LANGUAGES: readonly Language[] = ['el', 'en'];

/** The one key this product writes to `localStorage`, and it is not medical. */
export const LANGUAGE_KEY = 'medigraph:language';

const EL = {
  appName: 'Medigraph',
  languageName: 'Ελληνικά',
  switchTo: 'English',

  landing: {
    tagline: 'Δείτε τα δικά σας εργαστηριακά αποτελέσματα στον χρόνο.',
    what: 'Το Medigraph διαβάζει τα PDF εξετάσεων που κατεβάζετε από τον Ατομικό Ηλεκτρονικό Φάκελο Υγείας (myhealth.gov.gr) και τα δείχνει ως ιστορικό. Η επεξεργασία γίνεται στη συσκευή σας.',
    open: 'Άνοιγμα εφαρμογής',
    privacy: 'Ιδιωτικότητα',
  },

  disclaimer: {
    dataStays:
      'Τα έγγραφα, το κείμενο που εξάγεται από αυτά και τα αποτελέσματά σας παραμένουν στη συσκευή σας. Δεν αποθηκεύουμε κανένα δεδομένο σας σε διακομιστές που λειτουργούμε εμείς.',
    plaintext:
      'Το ιστορικό σας αποθηκεύεται τοπικά στον browser χωρίς κρυπτογράφηση, όπως και τα αρχεία που εξάγετε. Προστατέψτε τα όπως τα πρωτότυπα αποτελέσματά σας.',
    displayOnly:
      'Το Medigraph εμφανίζει όσα ανέφερε το εργαστήριό σας, μαζί με τις τιμές αναφοράς που τύπωσε το ίδιο. Δεν τα ερμηνεύει και δεν αποτελεί ιατρική συμβουλή.',
  },

  privacy: {
    heading: 'Ιδιωτικότητα',
    local:
      'Η ανάγνωση των εγγράφων, η αναγνώριση των δεικτών και η κατάρτιση του ιστορικού γίνονται εξ ολοκλήρου στη συσκευή σας, μέσα στον browser.',
    noServer:
      'Δεν αποθηκεύουμε κανένα δεδομένο σας σε διακομιστές που λειτουργούμε εμείς. Δεν υπάρχει λογαριασμός, δεν υπάρχει συγχρονισμός και δεν υπάρχει τηλεμετρία.',
    plaintext:
      'Τα δεδομένα φυλάσσονται τοπικά χωρίς κρυπτογράφηση, στη βάση IndexedDB του browser. Το αρχείο .medigraph που εξάγετε είναι επίσης απλό κείμενο.',
    eviction:
      'Ο browser μπορεί να διαγράψει τοπικά δεδομένα όταν χρειαστεί χώρο, και σίγουρα τα διαγράφει αν καθαρίσετε τα δεδομένα περιήγησης. Κρατήστε ένα αντίγραφο με την εξαγωγή.',
    device:
      'Όποιος έχει πρόσβαση στη συσκευή ή στο προφίλ του browser σας έχει πρόσβαση και στα δεδομένα. Το ίδιο ισχύει για ένα αρχείο .medigraph που θα μοιραστείτε: περιέχει ολόκληρο το ιστορικό σας.',
    xss: 'Καμία εφαρμογή δεν είναι απρόσβλητη. Κώδικας που θα εκτελούνταν κακόβουλα μέσα στη σελίδα θα μπορούσε να διαβάσει ό,τι διαβάζει και η εφαρμογή· γι’ αυτό ο κώδικας που φορτώνεται είναι περιορισμένος και ελεγμένος, χωρίς αυτό να αποτελεί απόδειξη.',
    networkTab:
      'Μπορείτε να ανοίξετε την καρτέλα Δικτύου του browser και να δείτε μόνοι σας τι στέλνει η σελίδα ενώ επισυνάπτετε ένα έγγραφο. Η εφαρμογή κατεβάζει τα δικά της αρχεία, οπότε η καρτέλα δεν θα είναι άδεια· αυτό που μπορείτε να ελέγξετε είναι ότι κανένα αίτημα δεν μεταφέρει τα δεδομένα των εξετάσεών σας. Είναι ένας εύλογος έλεγχος, όχι απόδειξη.',
    displayOnly:
      'Το Medigraph δεν ερμηνεύει αποτελέσματα και δεν αποτελεί ιατρική συμβουλή. Εμφανίζει ό,τι ανέφερε το εργαστήριο και τις τιμές αναφοράς που τύπωσε το ίδιο.',
    back: 'Επιστροφή',
  },

  attach: {
    heading: 'Επισύναψη εγγράφου',
    instructions:
      'Σύρετε εδώ το PDF των εξετάσεών σας ή επιλέξτε το από τη συσκευή σας. Το Medigraph διαβάζει μόνο τα έγγραφα που κατεβάζετε από τον Ατομικό Ηλεκτρονικό Φάκελο Υγείας (myhealth.gov.gr).',
    limits: (files: number, pages: number, megabytes: number): string =>
      `Έως ${String(files)} αρχεία κάθε φορά, ${String(pages)} σελίδες συνολικά, έως ${String(megabytes)} MB ανά αρχείο.`,
    choose: 'Επιλογή αρχείων',
    reading: (source: number, count: number): string =>
      `Ανάγνωση εγγράφου ${String(source)} από ${String(count)}…`,
    pages: (source: number, count: number, page: number, pageCount: number): string =>
      `Έγγραφο ${String(source)} από ${String(count)}: ${String(page)} από ${String(pageCount)} σελίδες`,
    stop: 'Διακοπή',
    failures: {
      'too-many-files': (max: number): string =>
        `Επισυνάψατε περισσότερα από ${String(max)} αρχεία, οπότε δεν διαβάστηκε κανένα. Δοκιμάστε ξανά με λιγότερα.`,
      'too-many-pages': (max: number): string =>
        `Η επισύναψη ξεπέρασε τις ${String(max)} σελίδες και σταμάτησε εδώ. Όσα έγγραφα διαβάστηκαν πριν από αυτό παραμένουν.`,
      cancelled: (): string => 'Η ανάγνωση διακόπηκε. Όσα έγγραφα είχαν ήδη διαβαστεί παραμένουν.',
      'unsupported-type': (): string =>
        'Δεν είναι αρχείο PDF. Το Medigraph διαβάζει μόνο το PDF των εξετάσεων που κατεβάζετε από τον Ατομικό Ηλεκτρονικό Φάκελο Υγείας (myhealth.gov.gr).',
      'file-too-large': (megabytes: number): string =>
        `Ξεπερνά τα ${String(megabytes)} MB και δεν διαβάστηκε.`,
      'decode-failed': (): string =>
        'Το PDF δεν άνοιξε. Κατεβάστε το ξανά από το myhealth.gov.gr και επισυνάψτε το όπως είναι.',
      'not-ahfy-document': (): string =>
        'Δεν είναι έγγραφο ΑΗΦΥ. Κατεβάστε τις εξετάσεις σας σε PDF από το myhealth.gov.gr και επισυνάψτε το αρχείο χωρίς αλλαγές.',
    },
  },

  review: {
    heading: 'Έλεγχος πριν την αποθήκευση',
    identifiers: 'Προσωπικά στοιχεία που βρέθηκαν στο έγγραφο',
    identifiersEmpty: 'Δεν βρέθηκαν προσωπικά στοιχεία στο έγγραφο.',
    identifiersHelp:
      'Τίποτα δεν αποθηκεύεται πριν απαντήσετε για καθένα από αυτά. Η διαγραφή αφαιρεί το κείμενο και από τις γραμμές που το περιέχουν.',
    redact: 'Αφαίρεση από τα δεδομένα',
    deleteRows: (count: number): string => `Διαγραφή ${String(count)} γραμμών που το περιέχουν`,
    dismiss: 'Δεν είναι προσωπικό στοιχείο',
    answered: {
      redacted: 'Αφαιρέθηκε από τα δεδομένα. Το κείμενο δεν επανέρχεται.',
      'deleted-row': 'Οι γραμμές που το περιείχαν διαγράφηκαν.',
      'false-positive': 'Καταγράφηκε ότι δεν είναι προσωπικό στοιχείο.',
    },
    freeText: 'Ελεύθερο κείμενο που θα αποθηκευτεί',
    freeTextHelp:
      'Οι ετικέτες των άγνωστων δεικτών αποθηκεύονται όπως τις τύπωσε το εργαστήριο. Ελέγξτε ότι δεν περιέχουν προσωπικά στοιχεία.',
    samePerson: 'Το έγγραφο αφορά το ίδιο πρόσωπο με το ιστορικό που είναι ήδη αποθηκευμένο.',
    samePersonHelp:
      'Το Medigraph δεν διαβάζει τον ΑΜΚΑ για να το απαντήσει αυτό· τον διαγράφει και ρωτάει εσάς.',
    stored: (count: number, latest: string): string =>
      `Το αρχείο σας έχει ήδη ${String(count)} εξετάσεις, με πιο πρόσφατη την ${latest}.`,
    document: 'Έγγραφο',
    rowCount: (count: number): string => `${String(count)} γραμμές`,
    dateLabel: 'Ημερομηνία λήψης δείγματος',
    timeLabel: 'Ώρα (μόνο αν χρειάζεται να ξεχωρίσει από άλλη εξέταση της ίδιας ημέρας)',
    confirmDate: 'Επιβεβαίωση ημερομηνίας',
    dateConfirmed: 'Η ημερομηνία επιβεβαιώθηκε.',
    sameDay: (date: string): string =>
      `Το αρχείο σας έχει ήδη εξέταση στις ${date}. Δώστε διαφορετική ώρα σε καθεμία για να ξεχωρίζουν.`,
    storedTime: 'Ώρα της αποθηκευμένης εξέτασης',
    targetLabel: 'Καταχώριση',
    targetNew: 'Νέα εξέταση',
    targetExisting: (date: string): string => `Προσθήκη στην εξέταση της ${date}`,
    conflict: (marker: string, count: number): string =>
      `Ο δείκτης ${marker} εμφανίζεται ${String(count)} φορές. Κρατήστε ένα αποτέλεσμα.`,
    keepThis: 'Κράτηση αυτού',
    conflictAnswered: 'Επιλέχθηκε ένα αποτέλεσμα.',
    changeConflict: 'Αλλαγή επιλογής',
    columns: {
      marker: 'Δείκτης',
      result: 'Αποτέλεσμα',
      unit: 'Μονάδα',
      range: 'Τιμές αναφοράς',
      actions: 'Ενέργειες',
    },
    unknownMarker: 'Άγνωστος δείκτης',
    approvedMarker: 'αποδεκτός',
    approve: 'Αποδοχή ως έχει',
    reassign: 'Αλλαγή δείκτη',
    reassignSearch: 'Αναζήτηση δείκτη',
    edit: 'Διόρθωση',
    save: 'Αποθήκευση',
    cancelEdit: 'Ακύρωση',
    remove: 'Διαγραφή γραμμής',
    inspect: 'Πηγή',
    resultKind: 'Είδος αποτελέσματος',
    kinds: {
      value: 'Αριθμητικό',
      categorical: 'Περιγραφικό',
      missing: 'Δεν διαβάστηκε',
    },
    valueLabel: 'Τιμή',
    unitLabel: 'Μονάδα',
    rangeLabel: 'Τιμές αναφοράς',
    textLabel: 'Αποτέλεσμα',
    preAccepted: (count: number): string =>
      `${String(count)} γραμμές διαβάστηκαν χωρίς επιφύλαξη και θα αποθηκευτούν όπως είναι. Δείτε τες κι αυτές.`,
    nothingToReview: 'Καμία γραμμή δεν χρειάζεται έλεγχο.',
    evidencePage: (file: string, page: number): string => `${file}, σελίδα ${String(page)}`,
    evidenceUnavailable: 'Δεν υπάρχει διαθέσιμη προεπισκόπηση της πηγής.',
    evidenceUnknownPage: 'Η σελίδα αυτή δεν υπάρχει στο έγγραφο.',
    evidenceClosed: 'Το έγγραφο αυτό δεν είναι πλέον ανοιχτό.',
    blockersTitle: 'Πριν την οριστικοποίηση μένουν:',
    blockers: {
      dates: (count: number): string => `${String(count)} ημερομηνίες προς επιβεβαίωση.`,
      identifiers: (count: number): string => `${String(count)} προσωπικά στοιχεία χωρίς απάντηση.`,
      conflicts: (count: number): string => `${String(count)} δείκτες που εμφανίζονται δύο φορές.`,
      unknowns: (count: number): string => `${String(count)} άγνωστοι δείκτες προς αποδοχή.`,
      samePerson: 'Η επιβεβαίωση ότι πρόκειται για το ίδιο πρόσωπο.',
      unsaved: (count: number): string => `${String(count)} αλλαγές δεν έχουν αποθηκευτεί.`,
      calendar:
        'Δύο εξετάσεις με την ίδια ημερομηνία χρειάζονται διαφορετική ώρα, ή μια ημερομηνία δεν είναι έγκυρη.',
      nothing: 'Δεν υπάρχει τίποτα προς οριστικοποίηση.',
    },
    confirm: 'Οριστικοποίηση',
    cancel: 'Ακύρωση',
    identifierKinds: {
      name: 'Όνομα',
      'national-id': 'ΑΜΚΑ',
      'patient-id': 'Κωδικός ασθενούς',
      phone: 'Τηλέφωνο',
      email: 'Διεύθυνση email',
      address: 'Διεύθυνση',
      other: 'Άλλο στοιχείο',
    },
    flags: {
      'ambiguous-thousands': 'Ασαφής υποδιαστολή',
      'ambiguous-role': 'Ασαφής στήλη',
      'implausible-value': 'Τιμή εκτός αναμενόμενου εύρους',
      'unrecognised-unit': 'Άγνωστη μονάδα',
      'unparsed-range': 'Αδιάβαστο εύρος αναφοράς',
      'competing-anchor': 'Δύο πιθανοί δείκτες',
      'low-ocr-confidence': 'Αβέβαιη ανάγνωση',
    },
  },

  panel: {
    heading: 'Αποτελέσματα εξέτασης',
    reports: 'Επιλογή εξέτασης',
    empty: 'Δεν υπάρχει καμία αποθηκευμένη εξέταση.',
    emptyReport: 'Η εξέταση αυτή δεν περιέχει κανένα αποτέλεσμα.',
    missing: '—',
    noRange: 'Το εργαστήριο δεν τύπωσε τιμές αναφοράς.',
    splitUnit:
      'Ο δείκτης αυτός έχει καταγραφεί και σε άλλη μονάδα· οι δύο σειρές δεν συγχωνεύονται.',
    status: {
      within: 'εντός των τιμών αναφοράς που ανέφερε το εργαστήριο',
      below: 'κάτω από τις τιμές αναφοράς που ανέφερε το εργαστήριο',
      above: 'πάνω από τις τιμές αναφοράς που ανέφερε το εργαστήριο',
      unavailable: 'χωρίς σύγκριση με τιμές αναφοράς',
    },
  },

  trend: {
    back: 'Πίσω στα αποτελέσματα',
    showTable: 'Εμφάνιση ως πίνακα',
    hideTable: 'Εμφάνιση ως διάγραμμα',
    noValues: 'Καμία καταγεγραμμένη τιμή.',
    noRecords: 'Καμία καταγραφή.',
    summary: (count: number, from: string, to: string): string =>
      `${String(count)} καταγραφές, από ${from} έως ${to}.`,
    censored:
      'Το εργαστήριο ανέφερε ότι η τιμή είναι κάτω ή πάνω από αυτό το όριο· η ακριβής τιμή είναι άγνωστη.',
    columns: {
      date: 'Ημερομηνία',
      value: 'Τιμή που αναφέρθηκε',
      unit: 'Μονάδα',
      range: 'Τιμές αναφοράς',
      status: 'Σύγκριση',
    },
  },

  data: {
    heading: 'Τα δεδομένα σας',
    exportHeading: 'Αντίγραφο των δεδομένων σας',
    exportWarning:
      'Το αρχείο που κατεβάζετε είναι απλό κείμενο και περιέχει ολόκληρο το ιατρικό σας ιστορικό, χωρίς κρυπτογράφηση. Όποιος το ανοίξει το διαβάζει. Φυλάξτε το όπως θα φυλάγατε τα ίδια τα χαρτιά των εξετάσεων.',
    exportAction: 'Λήψη αρχείου .medigraph',
    importHeading: 'Εισαγωγή αρχείου .medigraph',
    importAction: 'Επιλογή αρχείου',
    previewHeading: 'Τι περιέχει το αρχείο',
    previewSummary: (count: number, from: string, to: string): string =>
      `Το αρχείο περιέχει ${String(count)} εξετάσεις, από ${from} έως ${to}.`,
    cancel: 'Ακύρωση',
    importEmpty: 'Εισαγωγή',
    replace: 'Αντικατάσταση όλων',
    merge: 'Συγχώνευση με τα υπάρχοντα',
    replaceConfirm: (count: number): string =>
      `Η αντικατάσταση διαγράφει οριστικά ${String(count)} αποθηκευμένες εξετάσεις από αυτή τη συσκευή. Δεν υπάρχει αντίγραφο εκτός συσκευής.`,
    replaceConfirmAction: 'Ναι, αντικατάσταση',
    samePerson: 'Το αρχείο αφορά το ίδιο πρόσωπο με το ιστορικό που είναι ήδη αποθηκευμένο.',
    mergeBlocked:
      'Το αρχείο περιέχει εξέταση με το ίδιο αναγνωριστικό αλλά διαφορετικό περιεχόμενο. Η συγχώνευση δεν μπορεί να αποφασίσει ποια ισχύει.',
    sameDay:
      'Δύο εξετάσεις πέφτουν την ίδια ημέρα. Δώστε διαφορετική ώρα στην καθεμία για να ξεχωρίζουν.',
    storedTime: 'Ώρα της αποθηκευμένης',
    incomingTime: 'Ώρα αυτής που εισάγετε',
    reportsHeading: 'Αποθηκευμένες εξετάσεις',
    reportLine: (date: string, count: number): string => `${date} — ${String(count)} αποτελέσματα`,
    deleteReport: 'Διαγραφή',
    deleteReportConfirm: 'Ναι, διαγραφή αυτής της εξέτασης',
    clearAll: 'Διαγραφή όλων από αυτή τη συσκευή',
    clearAllConfirm:
      'Διαγράφονται οριστικά όλες οι εξετάσεις, η τοπική βάση και η προσωρινή μνήμη της εφαρμογής από αυτή τη συσκευή.',
    clearAllAction: 'Ναι, διαγραφή όλων',
    empty:
      'Δεν υπάρχει τίποτα αποθηκευμένο ακόμη. Επισυνάψτε ένα έγγραφο ΑΗΦΥ από το myhealth.gov.gr ή εισαγάγετε ένα αρχείο .medigraph.',
    persistence: {
      granted:
        'Ο browser έχει σημειώσει τα δεδομένα ως μόνιμα. Μπορούν και πάλι να χαθούν αν διαγράψετε τα δεδομένα περιήγησης, οπότε κρατήστε ένα αντίγραφο.',
      denied:
        'Ο browser δεν εγγυάται τη διατήρηση των δεδομένων: μπορεί να τα διαγράψει όταν χρειαστεί χώρο. Κρατήστε ένα αντίγραφο με τη Λήψη παραπάνω.',
      unknown:
        'Ο browser δεν απάντησε αν θα διατηρήσει τα δεδομένα. Κρατήστε ένα αντίγραφο με τη Λήψη παραπάνω.',
    },
    errors: {
      'file-too-large': 'Το αρχείο είναι πολύ μεγάλο για αρχείο .medigraph.',
      'malformed-json': 'Το αρχείο δεν διαβάζεται· δεν είναι έγκυρο JSON.',
      'not-medigraph': 'Δεν είναι αρχείο .medigraph.',
      'unsupported-version': 'Το αρχείο γράφτηκε από νεότερη έκδοση του Medigraph.',
      'invalid-profile': 'Τα περιεχόμενα δεν είναι έγκυρο ιστορικό Medigraph.',
    },
  },
};

/**
 * The shape every language must fill, inferred from Greek rather than declared.
 *
 * Deliberately not `as const`: the types are `string`, so English is checked
 * for having every key rather than for repeating the Greek words.
 */
export type Copy = typeof EL;

const EN: Copy = {
  appName: 'Medigraph',
  languageName: 'English',
  switchTo: 'Ελληνικά',

  landing: {
    tagline: 'See your own laboratory results over time.',
    what: 'Medigraph reads the results PDFs you download from the Greek national health record (myhealth.gov.gr) and shows them as a history. The processing happens on your device.',
    open: 'Open the app',
    privacy: 'Privacy',
  },

  disclaimer: {
    dataStays:
      'Your documents, the text taken from them and your results stay on your device. We store none of your data on any server we operate.',
    plaintext:
      'Your history is stored locally in the browser without encryption, and so are the files you export. Protect them the way you would protect the original results.',
    displayOnly:
      'Medigraph shows what your laboratory reported, alongside the reference values it printed itself. It does not interpret them and is not medical advice.',
  },

  privacy: {
    heading: 'Privacy',
    local:
      'Reading the documents, recognising the markers and building the history all happen on your device, inside the browser.',
    noServer:
      'We store none of your data on any server we operate. There is no account, no sync and no telemetry.',
    plaintext:
      'The data is kept locally without encryption, in the browser’s IndexedDB. The .medigraph file you export is plain text as well.',
    eviction:
      'A browser may delete local data when it needs space, and certainly deletes it if you clear your browsing data. Keep a copy by exporting one.',
    device:
      'Anyone with access to your device or browser profile has access to the data. The same is true of a .medigraph file you share: it holds your whole history.',
    xss: 'No application is invulnerable. Code running maliciously inside the page could read what the application reads; that is why the code loaded here is limited and reviewed, which is not the same as proof.',
    networkTab:
      'You can open the browser’s Network tab and watch for yourself what the page sends while you attach a document. The app downloads its own files, so the tab will not be empty; what you can check is that no request carries the data from your results. It is a reasonable check, not proof.',
    displayOnly:
      'Medigraph does not interpret results and is not medical advice. It shows what the laboratory reported and the reference values it printed itself.',
    back: 'Back',
  },

  attach: {
    heading: 'Attach a document',
    instructions:
      'Drop the PDF of your results here, or choose it from your device. Medigraph reads only the documents you download from the Greek national health record (myhealth.gov.gr).',
    limits: (files: number, pages: number, megabytes: number): string =>
      `Up to ${String(files)} files at a time, ${String(pages)} pages in total, up to ${String(megabytes)} MB each.`,
    choose: 'Choose files',
    reading: (source: number, count: number): string =>
      `Reading document ${String(source)} of ${String(count)}…`,
    pages: (source: number, count: number, page: number, pageCount: number): string =>
      `Document ${String(source)} of ${String(count)}: ${String(page)} of ${String(pageCount)} pages`,
    stop: 'Stop',
    failures: {
      'too-many-files': (max: number): string =>
        `You attached more than ${String(max)} files, so none were read. Try again with fewer.`,
      'too-many-pages': (max: number): string =>
        `The batch went past ${String(max)} pages and stopped there. The documents read before it are kept.`,
      cancelled: (): string => 'Reading stopped. The documents already read are kept.',
      'unsupported-type': (): string =>
        'This is not a PDF file. Medigraph reads only the results PDF you download from the Greek national health record (myhealth.gov.gr).',
      'file-too-large': (megabytes: number): string =>
        `This is larger than ${String(megabytes)} MB and was not read.`,
      'decode-failed': (): string =>
        'The PDF would not open. Download it again from myhealth.gov.gr and attach it unchanged.',
      'not-ahfy-document': (): string =>
        'This is not a national health record document. Download your results as a PDF from myhealth.gov.gr and attach the file unchanged.',
    },
  },

  review: {
    heading: 'Check before saving',
    identifiers: 'Personal details found in the document',
    identifiersEmpty: 'No personal details were found in the document.',
    identifiersHelp:
      'Nothing is saved until each of these has an answer. Removing one takes the text out of the rows that carry it as well.',
    redact: 'Remove from the data',
    deleteRows: (count: number): string => `Delete the ${String(count)} rows that contain it`,
    dismiss: 'Not a personal detail',
    answered: {
      redacted: 'Removed from the data. The text does not come back.',
      'deleted-row': 'The rows that contained it were deleted.',
      'false-positive': 'Recorded as not a personal detail.',
    },
    freeText: 'Free text that will be saved',
    freeTextHelp:
      'Unknown marker labels are saved exactly as the laboratory printed them. Check that they carry no personal details.',
    samePerson: 'This document is for the same person as the history already stored.',
    samePersonHelp:
      'Medigraph does not read the national id to answer this; it redacts it and asks you.',
    stored: (count: number, latest: string): string =>
      `Your record already holds ${String(count)} results, the most recent from ${latest}.`,
    document: 'Document',
    rowCount: (count: number): string => `${String(count)} rows`,
    dateLabel: 'Sample collection date',
    timeLabel: 'Time (only needed to separate two results from the same day)',
    confirmDate: 'Confirm the date',
    dateConfirmed: 'The date is confirmed.',
    sameDay: (date: string): string =>
      `Your record already holds a result from ${date}. Give each a different time so they can be told apart.`,
    storedTime: 'Time of the stored result',
    targetLabel: 'Save as',
    targetNew: 'A new result',
    targetExisting: (date: string): string => `Add to the result from ${date}`,
    conflict: (marker: string, count: number): string =>
      `${marker} appears ${String(count)} times. Keep one result.`,
    keepThis: 'Keep this one',
    conflictAnswered: 'One result was chosen.',
    changeConflict: 'Change the choice',
    columns: {
      marker: 'Marker',
      result: 'Result',
      unit: 'Unit',
      range: 'Reference values',
      actions: 'Actions',
    },
    unknownMarker: 'Unknown marker',
    approvedMarker: 'accepted',
    approve: 'Accept as printed',
    reassign: 'Change the marker',
    reassignSearch: 'Search markers',
    edit: 'Correct',
    save: 'Save',
    cancelEdit: 'Cancel',
    remove: 'Delete row',
    inspect: 'Source',
    resultKind: 'Kind of result',
    kinds: {
      value: 'Numeric',
      categorical: 'Descriptive',
      missing: 'Not read',
    },
    valueLabel: 'Value',
    unitLabel: 'Unit',
    rangeLabel: 'Reference values',
    textLabel: 'Result',
    preAccepted: (count: number): string =>
      `${String(count)} rows were read without reservation and will be saved as they are. Look at them anyway.`,
    nothingToReview: 'No row needs checking.',
    evidencePage: (file: string, page: number): string => `${file}, page ${String(page)}`,
    evidenceUnavailable: 'No preview of the source is available.',
    evidenceUnknownPage: 'That page is not in the document.',
    evidenceClosed: 'That document is no longer open.',
    blockersTitle: 'Still to answer before saving:',
    blockers: {
      dates: (count: number): string => `${String(count)} dates to confirm.`,
      identifiers: (count: number): string => `${String(count)} personal details with no answer.`,
      conflicts: (count: number): string => `${String(count)} markers that appear twice.`,
      unknowns: (count: number): string => `${String(count)} unknown markers to accept.`,
      samePerson: 'Confirmation that this is the same person.',
      unsaved: (count: number): string => `${String(count)} changes are not saved.`,
      calendar:
        'Two results on the same date need different times, or one of the dates is not a real day.',
      nothing: 'There is nothing to save.',
    },
    confirm: 'Save',
    cancel: 'Cancel',
    identifierKinds: {
      name: 'Name',
      'national-id': 'National id',
      'patient-id': 'Patient id',
      phone: 'Telephone',
      email: 'Email address',
      address: 'Address',
      other: 'Other detail',
    },
    flags: {
      'ambiguous-thousands': 'Ambiguous decimal separator',
      'ambiguous-role': 'Ambiguous column',
      'implausible-value': 'Value outside the expected span',
      'unrecognised-unit': 'Unrecognised unit',
      'unparsed-range': 'Unreadable reference range',
      'competing-anchor': 'Two possible markers',
      'low-ocr-confidence': 'Uncertain reading',
    },
  },

  panel: {
    heading: 'Results of this test',
    reports: 'Choose a result',
    empty: 'Nothing is stored yet.',
    emptyReport: 'This result holds no measurements.',
    missing: '—',
    noRange: 'The laboratory printed no reference values.',
    splitUnit: 'This marker was also recorded in another unit; the two series are not merged.',
    status: {
      within: 'within the reference values the laboratory reported',
      below: 'below the reference values the laboratory reported',
      above: 'above the reference values the laboratory reported',
      unavailable: 'no comparison with reference values',
    },
  },

  trend: {
    back: 'Back to the results',
    showTable: 'Show as a table',
    hideTable: 'Show as a chart',
    noValues: 'No reported value.',
    noRecords: 'No records.',
    summary: (count: number, from: string, to: string): string =>
      `${String(count)} records, from ${from} to ${to}.`,
    censored:
      'The laboratory reported the value as below or above this bound; the exact value is unknown.',
    columns: {
      date: 'Date',
      value: 'Reported value',
      unit: 'Unit',
      range: 'Reported range',
      status: 'Comparison',
    },
  },

  data: {
    heading: 'Your data',
    exportHeading: 'A copy of your data',
    exportWarning:
      'The file you download is plain text and holds your entire medical history, unencrypted. Anyone who opens it can read it. Keep it the way you would keep the result papers themselves.',
    exportAction: 'Download a .medigraph file',
    importHeading: 'Import a .medigraph file',
    importAction: 'Choose a file',
    previewHeading: 'What the file holds',
    previewSummary: (count: number, from: string, to: string): string =>
      `The file holds ${String(count)} results, from ${from} to ${to}.`,
    cancel: 'Cancel',
    importEmpty: 'Import',
    replace: 'Replace everything',
    merge: 'Merge with what is stored',
    replaceConfirm: (count: number): string =>
      `Replacing permanently deletes ${String(count)} stored results from this device. There is no copy off the device.`,
    replaceConfirmAction: 'Yes, replace',
    samePerson: 'This file is for the same person as the history already stored.',
    mergeBlocked:
      'The file holds a result with the same identifier but different content. A merge cannot decide which one stands.',
    sameDay:
      'Two results fall on the same day. Give each a different time so they can be told apart.',
    storedTime: 'Time of the stored one',
    incomingTime: 'Time of the one being imported',
    reportsHeading: 'Stored results',
    reportLine: (date: string, count: number): string => `${date} — ${String(count)} measurements`,
    deleteReport: 'Delete',
    deleteReportConfirm: 'Yes, delete this result',
    clearAll: 'Delete everything from this device',
    clearAllConfirm:
      'This permanently deletes every result, the local database and the application’s cache from this device.',
    clearAllAction: 'Yes, delete everything',
    empty:
      'Nothing is stored yet. Attach a document from myhealth.gov.gr, or import a .medigraph file.',
    persistence: {
      granted:
        'The browser has marked this data as persistent. It can still be lost if you clear your browsing data, so keep a copy.',
      denied:
        'The browser does not guarantee to keep this data: it may delete it when it needs space. Keep a copy with the download above.',
      unknown:
        'The browser did not say whether it will keep this data. Keep a copy with the download above.',
    },
    errors: {
      'file-too-large': 'The file is too large to be a .medigraph file.',
      'malformed-json': 'The file cannot be read; it is not valid JSON.',
      'not-medigraph': 'This is not a .medigraph file.',
      'unsupported-version': 'The file was written by a newer version of Medigraph.',
      'invalid-profile': 'The contents are not a valid Medigraph history.',
    },
  },
};

export const COPY: Record<Language, Copy> = { el: EL, en: EN };

/**
 * The language a browser is asking for.
 *
 * Greek unless the reader's own preferences say otherwise, in the order they
 * state them: this is a product about Greek documents, so Greek is the answer
 * when nothing is known.
 */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.slice(0, 2).toLowerCase();
    if (base === 'el') {
      return 'el';
    }
    if (base === 'en') {
      return 'en';
    }
  }

  return 'el';
}

function isLanguage(value: string | null): value is Language {
  return value === 'el' || value === 'en';
}

/**
 * The stored preference, if the reader has expressed one.
 *
 * `localStorage` holds this and nothing else. A language is not medical data,
 * and it is the one thing worth remembering across visits that is safe to
 * remember in the clear.
 */
export function loadLanguage(): Language | null {
  try {
    const stored = globalThis.localStorage.getItem(LANGUAGE_KEY);

    return isLanguage(stored) ? stored : null;
  } catch {
    // A browser refusing storage is not an error worth surfacing: the reader
    // simply gets the language their browser asked for, every visit.
    return null;
  }
}

export function saveLanguage(language: Language): void {
  try {
    globalThis.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // As above.
  }
}

/**
 * The language in force, defaulting to Greek.
 *
 * The island always provides a value, so the default is what a component
 * mounted on its own — in a test — reads. Greek is the source language, so a
 * test asserting copy asserts the strings that were written first.
 */
export const LanguageContext = createContext<Language>('el');

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export function useCopy(): Copy {
  return COPY[useLanguage()];
}

/**
 * A date as the reader reads it, with the ISO form beside it.
 *
 * Review never shows a localised date alone: `05/04` is April in one country
 * and May in another, and the user is confirming which day a sample was taken.
 * The ISO form is the unambiguous one and is always present.
 */
export function localisedDate(iso: string, language: Language): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  const formatted = new Intl.DateTimeFormat(language === 'el' ? 'el-GR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed);

  return `${formatted} (${iso})`;
}

/** The failure codes the attach screen names, kept in step with the router. */
export type AttachFailureCode = FileRouteErrorCode;
/** The read errors the data screen names, kept in step with the file format. */
export type ImportErrorCode = MedigraphReadError;
