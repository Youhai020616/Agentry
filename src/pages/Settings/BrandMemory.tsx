/**
 * Brand Memory Settings
 * Form-based UI for entering business/brand context that gets injected
 * into all AI employee system prompts via semantic memory.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Building2, Package, Target, Users, Save, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface CompetitorEntry {
  name: string;
  notes: string;
}

/**
 * Load semantic memory entries for a category via IPC
 */
async function loadCategory(category: string): Promise<Record<string, string>> {
  try {
    const result = (await window.electron.ipcRenderer.invoke(
      'memory:getSemanticByCategory',
      category
    )) as { success: boolean; result?: Record<string, string>; error?: string };
    if (result.success && result.result) {
      return result.result;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Save a single semantic memory key-value pair
 */
async function saveSemantic(category: string, key: string, value: string): Promise<boolean> {
  try {
    const result = (await window.electron.ipcRenderer.invoke(
      'memory:setSemantic',
      category,
      key,
      value
    )) as { success: boolean; error?: string };
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Delete a single semantic memory key
 */
async function deleteSemantic(category: string, key: string): Promise<boolean> {
  try {
    const result = (await window.electron.ipcRenderer.invoke(
      'memory:deleteSemantic',
      category,
      key
    )) as { success: boolean; error?: string };
    return result.success;
  } catch {
    return false;
  }
}

export function BrandMemory() {
  const { t } = useTranslation('settings');

  // Brand fields
  const [brandName, setBrandName] = useState('');
  const [brandTagline, setBrandTagline] = useState('');
  const [brandValues, setBrandValues] = useState('');
  const [brandTone, setBrandTone] = useState('');

  // Product fields
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productFeatures, setProductFeatures] = useState('');
  const [productPositioning, setProductPositioning] = useState('');

  // Competitor entries
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);

  // Audience fields
  const [audienceDescription, setAudienceDescription] = useState('');
  const [audienceDemographics, setAudienceDemographics] = useState('');
  const [audiencePainPoints, setAudiencePainPoints] = useState('');

  // Saving state per section
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingCompetitor, setSavingCompetitor] = useState(false);
  const [savingAudience, setSavingAudience] = useState(false);

  // Load data on mount
  const loadData = useCallback(async () => {
    const [brandData, productData, competitorData, audienceData] = await Promise.all([
      loadCategory('brand'),
      loadCategory('product'),
      loadCategory('competitor'),
      loadCategory('audience'),
    ]);

    // Brand
    setBrandName(brandData.name ?? '');
    setBrandTagline(brandData.tagline ?? '');
    setBrandValues(brandData.values ?? '');
    setBrandTone(brandData.tone ?? '');

    // Product
    setProductName(productData.name ?? '');
    setProductDescription(productData.description ?? '');
    setProductFeatures(productData.features ?? '');
    setProductPositioning(productData.positioning ?? '');

    // Competitors — stored as individual keys like "competitor_0_name", "competitor_0_notes"
    const competitorEntries: CompetitorEntry[] = [];
    const indices = new Set<string>();
    for (const key of Object.keys(competitorData)) {
      const match = key.match(/^competitor_(\d+)_/);
      if (match) {
        indices.add(match[1]);
      }
    }
    const sortedIndices = [...indices].sort((a, b) => Number(a) - Number(b));
    for (const idx of sortedIndices) {
      competitorEntries.push({
        name: competitorData[`competitor_${idx}_name`] ?? '',
        notes: competitorData[`competitor_${idx}_notes`] ?? '',
      });
    }
    if (competitorEntries.length === 0) {
      competitorEntries.push({ name: '', notes: '' });
    }
    setCompetitors(competitorEntries);

    // Audience
    setAudienceDescription(audienceData.description ?? '');
    setAudienceDemographics(audienceData.demographics ?? '');
    setAudiencePainPoints(audienceData.painPoints ?? '');
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save handlers
  const handleSaveBrand = async () => {
    setSavingBrand(true);
    try {
      await Promise.all([
        saveSemantic('brand', 'name', brandName),
        saveSemantic('brand', 'tagline', brandTagline),
        saveSemantic('brand', 'values', brandValues),
        saveSemantic('brand', 'tone', brandTone),
      ]);
      toast.success(t('brandMemory.saved'));
    } catch {
      toast.error('Failed to save brand context');
    } finally {
      setSavingBrand(false);
    }
  };

  const handleSaveProduct = async () => {
    setSavingProduct(true);
    try {
      await Promise.all([
        saveSemantic('product', 'name', productName),
        saveSemantic('product', 'description', productDescription),
        saveSemantic('product', 'features', productFeatures),
        saveSemantic('product', 'positioning', productPositioning),
      ]);
      toast.success(t('brandMemory.saved'));
    } catch {
      toast.error('Failed to save product context');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleSaveCompetitors = async () => {
    setSavingCompetitor(true);
    try {
      // First clear old competitor data
      const existingData = await loadCategory('competitor');
      const deletePromises = Object.keys(existingData).map((key) =>
        deleteSemantic('competitor', key)
      );
      await Promise.all(deletePromises);

      // Save current entries
      const savePromises: Promise<boolean>[] = [];
      competitors.forEach((entry, idx) => {
        if (entry.name.trim()) {
          savePromises.push(saveSemantic('competitor', `competitor_${idx}_name`, entry.name));
          savePromises.push(saveSemantic('competitor', `competitor_${idx}_notes`, entry.notes));
        }
      });
      await Promise.all(savePromises);
      toast.success(t('brandMemory.saved'));
    } catch {
      toast.error('Failed to save competitor context');
    } finally {
      setSavingCompetitor(false);
    }
  };

  const handleSaveAudience = async () => {
    setSavingAudience(true);
    try {
      await Promise.all([
        saveSemantic('audience', 'description', audienceDescription),
        saveSemantic('audience', 'demographics', audienceDemographics),
        saveSemantic('audience', 'painPoints', audiencePainPoints),
      ]);
      toast.success(t('brandMemory.saved'));
    } catch {
      toast.error('Failed to save audience context');
    } finally {
      setSavingAudience(false);
    }
  };

  // Competitor list management
  const addCompetitor = () => {
    setCompetitors([...competitors, { name: '', notes: '' }]);
  };

  const removeCompetitor = (index: number) => {
    setCompetitors(competitors.filter((_, i) => i !== index));
  };

  const updateCompetitor = (index: number, field: keyof CompetitorEntry, value: string) => {
    const updated = [...competitors];
    updated[index] = { ...updated[index], [field]: value };
    setCompetitors(updated);
  };

  return (
    <div className="space-y-6">
      {/* Brand Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('brandMemory.brand.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('brandMemory.brand.name')}</Label>
              <Input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('brandMemory.brand.tagline')}</Label>
              <Input
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                placeholder="Making the world better"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.brand.values')}</Label>
            <Textarea
              value={brandValues}
              onChange={(e) => setBrandValues(e.target.value)}
              placeholder="Innovation, Quality, Customer-First..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.brand.tone')}</Label>
            <Textarea
              value={brandTone}
              onChange={(e) => setBrandTone(e.target.value)}
              placeholder="Professional yet approachable, data-driven..."
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveBrand} disabled={savingBrand} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {t('brandMemory.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Product Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('brandMemory.product.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('brandMemory.product.name')}</Label>
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Product X"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('brandMemory.product.positioning')}</Label>
              <Input
                value={productPositioning}
                onChange={(e) => setProductPositioning(e.target.value)}
                placeholder="The leading solution for..."
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.product.description')}</Label>
            <Textarea
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="A brief description of your product..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.product.features')}</Label>
            <Textarea
              value={productFeatures}
              onChange={(e) => setProductFeatures(e.target.value)}
              placeholder="Key feature 1, Key feature 2..."
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveProduct} disabled={savingProduct} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {t('brandMemory.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Competitor Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {t('brandMemory.competitor.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {competitors.map((entry, index) => (
            <div key={index} className="flex gap-3 items-start">
              <div className="flex-1 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('brandMemory.competitor.name')}</Label>
                  <Input
                    value={entry.name}
                    onChange={(e) => updateCompetitor(index, 'name', e.target.value)}
                    placeholder="Competitor name"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('brandMemory.competitor.notes')}</Label>
                  <Input
                    value={entry.notes}
                    onChange={(e) => updateCompetitor(index, 'notes', e.target.value)}
                    placeholder="Key differentiators, strengths, weaknesses..."
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="mt-5 shrink-0"
                onClick={() => removeCompetitor(index)}
                disabled={competitors.length <= 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}

          <Separator />

          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={addCompetitor}>
              <Plus className="h-4 w-4 mr-2" />
              {t('brandMemory.competitor.add')}
            </Button>
            <Button onClick={handleSaveCompetitors} disabled={savingCompetitor} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {t('brandMemory.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Audience Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('brandMemory.audience.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('brandMemory.audience.description')}</Label>
            <Textarea
              value={audienceDescription}
              onChange={(e) => setAudienceDescription(e.target.value)}
              placeholder="Who are your target customers?"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.audience.demographics')}</Label>
            <Textarea
              value={audienceDemographics}
              onChange={(e) => setAudienceDemographics(e.target.value)}
              placeholder="Age, location, industry, company size..."
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('brandMemory.audience.painPoints')}</Label>
            <Textarea
              value={audiencePainPoints}
              onChange={(e) => setAudiencePainPoints(e.target.value)}
              placeholder="What problems do they face?"
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveAudience} disabled={savingAudience} size="sm">
              <Save className="h-4 w-4 mr-2" />
              {t('brandMemory.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
