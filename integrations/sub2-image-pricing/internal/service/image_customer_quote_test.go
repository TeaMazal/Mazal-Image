package service

import (
	"context"
	"math"
	"testing"
)

func TestImageCustomerQuoteUsesBillingPrices(t *testing.T) {
	price1, price2, price4 := 0.03, 0.05, 0.1
	id := int64(64)
	key := &APIKey{GroupID: &id, UserID: 1, Group: &Group{ID: id, Platform: PlatformOpenAI, AllowImageGeneration: true, RateMultiplier: 2, ImagePrice1K: &price1, ImagePrice2K: &price2, ImagePrice4K: &price4}}
	s := &OpenAIGatewayService{billingService: &BillingService{}}
	prices, err := s.ImagePricingForKey(context.Background(), key, "gpt-image-2")
	if err != nil || math.Abs(prices["1K"]-0.06) > 1e-10 || math.Abs(prices["2K"]-0.1) > 1e-10 || math.Abs(prices["4K"]-0.2) > 1e-10 {
		t.Fatalf("unexpected group prices: %#v, %v", prices, err)
	}
	key.Group.ImageRateIndependent = true
	key.Group.ImageRateMultiplier = 0.5
	prices, err = s.ImagePricingForKey(context.Background(), key, "gpt-image-2")
	if err != nil || math.Abs(prices["1K"]-0.015) > 1e-10 {
		t.Fatalf("independent image multiplier ignored: %#v, %v", prices, err)
	}
	key.Group.ImageRateMultiplier = 0
	prices, err = s.ImagePricingForKey(context.Background(), key, "gpt-image-2")
	if err != nil || prices["1K"] != 0 {
		t.Fatalf("free pricing rejected: %#v, %v", prices, err)
	}
}

func TestImageCustomerQuoteRejectsUnsupportedOrInvalidPricing(t *testing.T) {
	s := &OpenAIGatewayService{billingService: &BillingService{}}
	if _, err := s.ImagePricingForKey(context.Background(), nil, "gpt-image-2"); err == nil {
		t.Fatal("missing identity accepted")
	}
	id := int64(64)
	invalid := math.NaN()
	key := &APIKey{GroupID: &id, Group: &Group{ID: id, Platform: PlatformOpenAI, RateMultiplier: 1, ImagePrice1K: &invalid}}
	if _, err := s.ImagePricingForKey(context.Background(), key, "gpt-image-2"); err == nil {
		t.Fatal("disabled image group accepted")
	}
	key.Group.AllowImageGeneration = true
	if _, err := s.ImagePricingForKey(context.Background(), key, "gpt-image-2"); err == nil {
		t.Fatal("invalid image price accepted")
	}
}
