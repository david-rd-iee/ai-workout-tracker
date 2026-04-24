import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firestore } from '@angular/fire/firestore';
import { deleteObject, ref, Storage } from '@angular/fire/storage';
import { AlertController, IonicModule, ToastController } from '@ionic/angular';
import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  DEFAULT_STATUE_STAGE_IMAGES,
  StatueCategory,
  StatueLevel,
} from '../../models/greek-statue.model';
import { AccountService } from '../../services/account/account.service';
import { FileUploadService } from '../../services/file-upload.service';
import { STATUES_DASHBORD_ALLOWED_EMAIL } from './statues-dashbord.constants';

type StageImageMap = Record<StatueLevel, string>;
type TierMap = Record<StatueLevel, number>;

type GreekStatueAdminDoc = {
  docId: string;
  id: string;
  godName: string;
  title: string;
  icon: string;
  customIcon?: string;
  stageImages: StageImageMap;
  description: string;
  category: StatueCategory;
  metric: string;
  mythology: string;
  levelingConstant: number;
  tiers: TierMap;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

type EditableGreekStatueForm = {
  id: string;
  godName: string;
  title: string;
  icon: string;
  customIcon: string;
  description: string;
  category: StatueCategory;
  metric: string;
  mythology: string;
  levelingConstant: string;
  stageImages: StageImageMap;
  tiers: TierMap;
};

type MetricOption = {
  value: string;
  label: string;
};

@Component({
  selector: 'app-statues-dashbord',
  standalone: true,
  templateUrl: './statues-dashbord.page.html',
  styleUrls: ['./statues-dashbord.page.scss'],
  imports: [CommonModule, FormsModule, IonicModule],
})
export class StatuesDashbordPage implements OnInit, OnDestroy {
  private readonly collectionBootstrapDocId = '__meta__';
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly fileUploadService = inject(FileUploadService);
  private readonly accountService = inject(AccountService);
  private readonly toastController = inject(ToastController);
  private readonly alertController = inject(AlertController);

  readonly authorizedEmail = STATUES_DASHBORD_ALLOWED_EMAIL;
  readonly collectionName = 'GreekStatues';
  readonly stageLevels: StatueLevel[] = ['rough', 'outlined', 'detailed', 'polished', 'gilded', 'divine'];
  readonly categoryOptions: StatueCategory[] = [
    'strength',
    'endurance',
    'consistency',
    'progress',
    'social',
    'milestone',
  ];
  readonly metricOptions: MetricOption[] = [
    { value: 'age', label: 'age' },
    { value: 'heightMeters', label: 'heightMeters' },
    { value: 'weightKg', label: 'weightKg' },
    { value: 'bmi', label: 'bmi' },
    { value: 'sex', label: 'sex' },
    { value: 'userScore / totalScore', label: 'userScore / totalScore' },
    {
      value: 'userScore / maxAddedScoreWithinDay',
      label: 'userScore / maxAddedScoreWithinDay',
    },
    {
      value: 'userScore / cardioScore / totalCardioScore',
      label: 'userScore / cardioScore / totalCardioScore',
    },
    {
      value: 'userScore / cardioScore / {numberFieldName}',
      label: 'userScore / cardioScore / {numberFieldName}',
    },
    {
      value: 'userScore / strengthScore / totalStrengthScore',
      label: 'userScore / strengthScore / totalStrengthScore',
    },
    {
      value: 'userScore / strengthScore / {numberFieldName}',
      label: 'userScore / strengthScore / {numberFieldName}',
    },
    {
      value: 'Expected_Effort / Cardio / {numberFieldName}',
      label: 'Expected_Effort / Cardio / {numberFieldName}',
    },
    {
      value: 'Expected_Effort / Strength / {numberFieldName}',
      label: 'Expected_Effort / Strength / {numberFieldName}',
    },
    { value: 'level', label: 'level' },
    { value: 'percentage_of_level', label: 'percentage_of_level' },
    { value: 'streakData / currentStreak', label: 'streakData / currentStreak' },
    { value: 'streakData / maxStreak', label: 'streakData / maxStreak' },
    {
      value: 'streakData / totalNumberOfDaysTracked',
      label: 'streakData / totalNumberOfDaysTracked',
    },
    {
      value: 'earlymorningWorkoutsTracker / earlyMorningWorkoutNumber',
      label: 'earlymorningWorkoutsTracker / earlyMorningWorkoutNumber',
    },
    {
      value: 'groupRankings / totalNumberOfMembers',
      label: 'groupRankings / totalNumberOfMembers',
    },
    {
      value: 'groupRankings / {numberFieldName}',
      label: 'groupRankings / {numberFieldName}',
    },
  ];

  isLoading = true;
  isSaving = false;
  isEditorOpen = false;
  loadError = '';
  savingStatus = '';
  deletingDocId: string | null = null;
  formMode: 'create' | 'edit' = 'create';
  editingDocId: string | null = null;
  statues: GreekStatueAdminDoc[] = [];
  form = this.createEmptyForm();

  private collectionUnsubscribe: Unsubscribe | null = null;
  private customIconFile: File | null = null;
  private stageImageFiles: Partial<Record<StatueLevel, File | null>> = {};

  ngOnInit(): void {
    void this.ensureGreekStatuesCollectionExists();
    this.observeGreekStatues();
  }

  ngOnDestroy(): void {
    this.collectionUnsubscribe?.();
  }

  get currentEmail(): string {
    return this.accountService.getCredentials()().email || this.authorizedEmail;
  }

  trackByStatueId(_index: number, statue: GreekStatueAdminDoc): string {
    return statue.docId;
  }

  startAddingStatue(): void {
    this.formMode = 'create';
    this.editingDocId = null;
    this.isEditorOpen = true;
    this.form = this.createEmptyForm();
    this.customIconFile = null;
    this.stageImageFiles = {};
  }

  editStatue(statue: GreekStatueAdminDoc): void {
    this.formMode = 'edit';
    this.editingDocId = statue.docId;
    this.isEditorOpen = true;
    this.customIconFile = null;
    this.stageImageFiles = {};
    this.form = {
      id: statue.id,
      godName: statue.godName,
      title: statue.title,
      icon: statue.icon,
      customIcon: statue.customIcon ?? '',
      description: statue.description,
      category: statue.category,
      metric: statue.metric,
      mythology: statue.mythology,
      levelingConstant: this.formatLevelingConstant(statue.levelingConstant),
      stageImages: { ...statue.stageImages },
      tiers: { ...statue.tiers },
    };
  }

  cancelEditing(): void {
    this.isEditorOpen = false;
    this.formMode = 'create';
    this.editingDocId = null;
    this.savingStatus = '';
    this.customIconFile = null;
    this.stageImageFiles = {};
    this.form = this.createEmptyForm();
  }

  async saveStatue(): Promise<void> {
    const validationMessage = this.validateForm();
    if (validationMessage) {
      await this.showToast(validationMessage);
      return;
    }

    const docId = this.resolveDocId();
    this.isSaving = true;
    this.savingStatus = 'Saving statue data...';

    try {
      const levelingConstant = this.parseLevelingConstant(this.form.levelingConstant);
      const stageImages = await this.resolveStageImages();
      const customIcon = await this.resolveCustomIcon();
      const tiers = this.buildTiersFromLevelingConstant(levelingConstant);
      const payload: Record<string, unknown> = {
        id: docId,
        godName: this.form.godName.trim(),
        title: this.form.title.trim(),
        icon: this.form.icon.trim(),
        description: this.form.description.trim(),
        category: this.form.category,
        metric: this.form.metric,
        mythology: this.form.mythology.trim(),
        levelingConstant,
        tiers,
        stageImages,
        updatedAt: serverTimestamp(),
      };

      if (customIcon) {
        payload['customIcon'] = customIcon;
      }

      const targetRef = doc(this.firestore, this.collectionName, docId);
      if (this.formMode === 'create') {
        payload['createdAt'] = serverTimestamp();
        await setDoc(targetRef, payload, { merge: true });
      } else {
        await updateDoc(targetRef, payload);
      }
      await this.showToast(
        this.formMode === 'create'
          ? `Created ${payload['godName'] as string}.`
          : `Updated ${payload['godName'] as string}.`
      );

      this.cancelEditing();
    } catch (error) {
      console.error('[StatuesDashbordPage] Failed to save Greek statue:', error);
      await this.showToast('We could not save that statue. Check Firebase permissions and try again.');
    } finally {
      this.isSaving = false;
      this.savingStatus = '';
    }
  }

  async logout(): Promise<void> {
    await this.accountService.logout();
  }

  async confirmDeleteStatue(statue: GreekStatueAdminDoc): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Delete Statue',
      message: `Delete ${statue.godName}? This removes the Firestore doc and attempts to delete uploaded statue images from Storage.`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.deleteStatue(statue);
          },
        },
      ],
    });

    await alert.present();
  }

  async onCustomIconSelected(event: Event): Promise<void> {
    const file = this.readSelectedFile(event);
    if (!file) {
      return;
    }

    this.customIconFile = file;
    this.form.customIcon = await this.readFileAsDataUrl(file);
  }

  async onStageImageSelected(stage: StatueLevel, event: Event): Promise<void> {
    const file = this.readSelectedFile(event);
    if (!file) {
      return;
    }

    this.stageImageFiles[stage] = file;
    this.form.stageImages[stage] = await this.readFileAsDataUrl(file);
  }

  getStageImagePreview(stage: StatueLevel): string {
    return this.form.stageImages[stage] || DEFAULT_STATUE_STAGE_IMAGES[stage];
  }

  private observeGreekStatues(): void {
    this.isLoading = true;
    this.loadError = '';

    this.collectionUnsubscribe = onSnapshot(
      collection(this.firestore, this.collectionName),
      (snapshot) => {
        this.statues = snapshot.docs
          .filter((docSnapshot) => docSnapshot.id !== this.collectionBootstrapDocId)
          .map((docSnapshot) =>
            this.normalizeGreekStatueDoc(docSnapshot.id, docSnapshot.data())
          )
          .sort((left, right) => left.godName.localeCompare(right.godName));
        this.isLoading = false;
      },
      (error) => {
        console.error('[StatuesDashbordPage] Failed to load GreekStatues:', error);
        this.loadError = 'We could not load the GreekStatues collection.';
        this.isLoading = false;
      }
    );
  }

  private async deleteStatue(statue: GreekStatueAdminDoc): Promise<void> {
    this.deletingDocId = statue.docId;

    try {
      await this.deleteGreekStatueAssets(statue);
      await deleteDoc(doc(this.firestore, this.collectionName, statue.docId));

      if (this.editingDocId === statue.docId) {
        this.cancelEditing();
      }

      await this.showToast(`Deleted ${statue.godName}.`);
    } catch (error) {
      console.error('[StatuesDashbordPage] Failed to delete Greek statue:', error);
      await this.showToast('We could not delete that statue. Please try again.');
    } finally {
      this.deletingDocId = null;
    }
  }

  private async deleteGreekStatueAssets(statue: GreekStatueAdminDoc): Promise<void> {
    const candidateUrls = [
      statue.customIcon ?? '',
      ...this.stageLevels.map((stage) => statue.stageImages[stage]),
    ];

    await Promise.all(
      candidateUrls.map(async (url) => {
        const storagePath = this.extractStoragePathFromDownloadUrl(url);
        if (!storagePath || !storagePath.startsWith('GreekStatues/')) {
          return;
        }

        try {
          await deleteObject(ref(this.storage, storagePath));
        } catch (error) {
          console.warn('[StatuesDashbordPage] Failed to delete statue asset:', storagePath, error);
        }
      })
    );
  }

  private async ensureGreekStatuesCollectionExists(): Promise<void> {
    try {
      await setDoc(
        doc(this.firestore, this.collectionName, this.collectionBootstrapDocId),
        {
          id: this.collectionBootstrapDocId,
          isSystemDoc: true,
          description: 'Bootstrap document used to materialize the GreekStatues collection.',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('[StatuesDashbordPage] Failed to bootstrap GreekStatues collection:', error);
    }
  }

  private normalizeGreekStatueDoc(docId: string, data: DocumentData): GreekStatueAdminDoc {
    return {
      docId,
      id: this.readText(data['id']) || docId,
      godName: this.readText(data['godName']),
      title: this.readText(data['title']),
      icon: this.readText(data['icon']),
      customIcon: this.readText(data['customIcon']) || undefined,
      stageImages: this.normalizeStageImages(data['stageImages']),
      description: this.readText(data['description']),
      category: this.normalizeCategory(data['category']),
      metric: this.readText(data['metric']) || this.metricOptions[0].value,
      mythology: this.readText(data['mythology']),
      levelingConstant: this.normalizeLevelingConstant(data['levelingConstant'], data['tiers']),
      tiers: this.normalizeTierMap(data['tiers']),
      createdAt: data['createdAt'] instanceof Timestamp ? data['createdAt'] : null,
      updatedAt: data['updatedAt'] instanceof Timestamp ? data['updatedAt'] : null,
    };
  }

  private createEmptyForm(): EditableGreekStatueForm {
    return {
      id: '',
      godName: '',
      title: '',
      icon: '',
      customIcon: '',
      description: '',
      category: 'strength',
      metric: this.metricOptions[0].value,
      mythology: '',
      levelingConstant: '',
      stageImages: { ...DEFAULT_STATUE_STAGE_IMAGES },
      tiers: {
        rough: 0,
        outlined: 0,
        detailed: 0,
        polished: 0,
        gilded: 0,
        divine: 0,
      },
    };
  }

  private resolveDocId(): string {
    if (this.formMode === 'edit' && this.editingDocId) {
      return this.editingDocId;
    }

    const titleWords = this.form.title.trim().split(/\s+/).filter(Boolean);
    const titleSuffix = titleWords.length > 0 ? titleWords[titleWords.length - 1] : '';
    const generatedBaseId = this.slugify(
      `${this.form.godName.trim()}-${titleSuffix}`
    ) || `greek-statue-${Date.now()}`;

    let candidate = generatedBaseId;
    let duplicateIndex = 2;

    while (
      this.statues.some((statue) => statue.docId === candidate || statue.id === candidate)
    ) {
      candidate = `${generatedBaseId}-${duplicateIndex}`;
      duplicateIndex += 1;
    }

    this.form.id = candidate;
    return candidate;
  }

  private async resolveStageImages(): Promise<StageImageMap> {
    const uploads = await Promise.all(
      this.stageLevels.map(async (stage) => {
        const selectedFile = this.stageImageFiles[stage];
        if (selectedFile) {
          this.savingStatus = `Uploading ${stage} stage image...`;
          const storagePath = this.buildStoragePath(
            this.buildGodStorageFolderName(),
            `stage-images/${stage}`,
            selectedFile.name
          );
          const uploadedUrl = await this.fileUploadService.uploadFile(storagePath, selectedFile);
          return [stage, uploadedUrl] as const;
        }

        const existingOrDefaultUrl = this.form.stageImages[stage] || DEFAULT_STATUE_STAGE_IMAGES[stage];
        if (this.isRemoteUrl(existingOrDefaultUrl)) {
          return [stage, existingOrDefaultUrl] as const;
        }

        this.savingStatus = `Uploading default ${stage} image...`;
        const defaultFile = await this.assetPathToFile(
          DEFAULT_STATUE_STAGE_IMAGES[stage],
          `${this.slugify(stage) || stage}.png`
        );
        const storagePath = this.buildStoragePath(
          this.buildGodStorageFolderName(),
          `stage-images/${stage}`,
          defaultFile.name
        );
        const uploadedUrl = await this.fileUploadService.uploadFile(storagePath, defaultFile);
        return [stage, uploadedUrl] as const;
      })
    );

    return uploads.reduce<StageImageMap>((accumulator, [stage, url]) => {
      accumulator[stage] = url;
      return accumulator;
    }, { ...DEFAULT_STATUE_STAGE_IMAGES });
  }

  private async resolveCustomIcon(): Promise<string> {
    if (!this.customIconFile) {
      return this.form.customIcon.trim();
    }

    this.savingStatus = 'Uploading custom icon...';
    const storagePath = this.buildStoragePath(
      this.buildGodStorageFolderName(),
      'custom-icon',
      this.customIconFile.name
    );
    return this.fileUploadService.uploadFile(storagePath, this.customIconFile);
  }

  private buildStoragePath(godFolderName: string, segment: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    return `GreekStatues/${godFolderName}/${segment}-${Date.now()}-${safeName}`;
  }

  private normalizeStageImages(value: unknown): StageImageMap {
    const stageImages =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return this.stageLevels.reduce<StageImageMap>((accumulator, stage) => {
      const candidate = this.readText(stageImages[stage]);
      accumulator[stage] = candidate || DEFAULT_STATUE_STAGE_IMAGES[stage];
      return accumulator;
    }, { ...DEFAULT_STATUE_STAGE_IMAGES });
  }

  private normalizeTierMap(value: unknown): TierMap {
    const tiers =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    return this.stageLevels.reduce<TierMap>((accumulator, stage) => {
      accumulator[stage] = this.readNumber(tiers[stage]);
      return accumulator;
    }, {
      rough: 0,
      outlined: 0,
      detailed: 0,
      polished: 0,
      gilded: 0,
      divine: 0,
    });
  }

  private normalizeCategory(value: unknown): StatueCategory {
    const candidate = this.readText(value) as StatueCategory;
    return this.categoryOptions.includes(candidate) ? candidate : 'strength';
  }

  private validateForm(): string {
    if (!this.form.godName.trim()) return 'Enter a god name.';
    if (!this.form.title.trim()) return 'Enter a title.';
    if (!this.form.icon.trim()) return 'Enter an icon.';
    if (!this.form.description.trim()) return 'Enter a description.';
    if (!this.form.mythology.trim()) return 'Enter a mythology description.';
    if (!this.parseLevelingConstant(this.form.levelingConstant)) {
      return 'Enter a leveling constant greater than 0.';
    }

    return '';
  }

  private readSelectedFile(event: Event): File | null {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (input) {
      input.value = '';
    }
    return file;
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private parseLevelingConstant(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private formatLevelingConstant(value: number): string {
    return value > 0 ? String(value) : '';
  }

  private normalizeLevelingConstant(value: unknown, tiers: unknown): number {
    const parsed = this.parseLevelingConstant(value);
    if (parsed > 0) {
      return parsed;
    }

    const normalizedTiers = this.normalizeTierMap(tiers);
    for (const stage of this.stageLevels) {
      const tierValue = normalizedTiers[stage];
      if (tierValue > 0) {
        return this.tierNumberForLevel(stage) / Math.sqrt(tierValue);
      }
    }

    return 0;
  }

  private buildTiersFromLevelingConstant(levelingConstant: number): TierMap {
    return this.stageLevels.reduce<TierMap>((accumulator, stage) => {
      const tierNumber = this.tierNumberForLevel(stage);
      accumulator[stage] = Math.round(Math.pow(tierNumber / levelingConstant, 2));
      return accumulator;
    }, {
      rough: 0,
      outlined: 0,
      detailed: 0,
      polished: 0,
      gilded: 0,
      divine: 0,
    });
  }

  private tierNumberForLevel(level: StatueLevel): number {
    const mapping: Record<StatueLevel, number> = {
      rough: 1,
      outlined: 2,
      detailed: 3,
      polished: 4,
      gilded: 5,
      divine: 6,
    };

    return mapping[level];
  }

  getComputedTierValue(stage: StatueLevel): number {
    const levelingConstant = this.parseLevelingConstant(this.form.levelingConstant);
    if (!levelingConstant) {
      return 0;
    }

    const tierNumber = this.tierNumberForLevel(stage);
    return Math.round(Math.pow(tierNumber / levelingConstant, 2));
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private buildGodStorageFolderName(): string {
    return this.form.godName.trim().replace(/[\\/#?[\]]+/g, '-').replace(/\s+/g, '-') || 'unknown-god';
  }

  private isRemoteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private extractStoragePathFromDownloadUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const marker = '/o/';
      const index = parsed.pathname.indexOf(marker);
      if (index === -1) {
        return null;
      }

      return decodeURIComponent(parsed.pathname.substring(index + marker.length));
    } catch {
      return null;
    }
  }

  private async assetPathToFile(assetPath: string, fallbackName: string): Promise<File> {
    const response = await fetch(assetPath);
    if (!response.ok) {
      throw new Error(`Unable to load asset: ${assetPath}`);
    }

    const blob = await response.blob();
    const assetSegments = assetPath.split('/');
    const assetName = assetSegments[assetSegments.length - 1] || fallbackName;
    return new File([blob], assetName, {
      type: blob.type || 'image/png',
    });
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      position: 'bottom',
    });
    await toast.present();
  }
}
