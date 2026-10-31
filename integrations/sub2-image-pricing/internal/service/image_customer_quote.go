package service

import (
	"context"
	"errors"
	"math"
)

// ImagePricingForKey 与图片用量扣费共用尺寸定价和用户分组倍率。
func (s *OpenAIGatewayService) ImagePricingForKey(ctx context.Context, apiKey *APIKey, model string) (map[string]float64, error) {
	if s == nil || s.billingService == nil || apiKey == nil || apiKey.Group == nil || apiKey.GroupID == nil {
		return nil, errors.New("image pricing unavailable")
	}
	apiKey = s.apiKeyWithFreshGroupMediaPricing(ctx, apiKey)
	if apiKey.Group.Platform != PlatformOpenAI || !apiKey.Group.AllowImageGeneration {
		return nil, errors.New("image pricing unsupported for this group")
	}
	rate := s.ResolveUserGroupRateMultiplier(ctx, apiKey.UserID, *apiKey.GroupID, apiKey.Group.RateMultiplier)
	multiplier := resolveImageRateMultiplier(apiKey, rate)
	prices := make(map[string]float64, 3)
	for _, tier := range []string{ImageBillingSize1K, ImageBillingSize2K, ImageBillingSize4K} {
		cost := s.calculateOpenAIImageCost(ctx, model, apiKey, &OpenAIForwardResult{ImageCount: 1, ImageSize: tier}, multiplier)
		if cost == nil || math.IsNaN(cost.ActualCost) || math.IsInf(cost.ActualCost, 0) || cost.ActualCost < 0 {
			return nil, errors.New("invalid image pricing")
		}
		prices[tier] = cost.ActualCost
	}
	return prices, nil
}
