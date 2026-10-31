package handler

import (
	"net/http"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// ImagePricing 仅返回调用者当前分组的图片单价，不返回密钥或管理配置。
func (h *GatewayHandler) ImagePricing(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	apiKey, ok := middleware2.GetAPIKeyFromContext(c)
	if !ok {
		h.errorResponse(c, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	if apiKey.Group == nil || apiKey.GroupID == nil || !apiKey.Group.AllowImageGeneration {
		h.errorResponse(c, http.StatusForbidden, "permission_error", "当前密钥所属分组未开放绘图")
		return
	}
	if apiKey.Group.Platform != service.PlatformOpenAI {
		h.errorResponse(c, http.StatusServiceUnavailable, "api_error", "当前分组暂不支持图片报价，请查看主站账单")
		return
	}
	prices, err := h.openAIGatewayService.ImagePricingForKey(c.Request.Context(), apiKey, "gpt-image-2")
	if err != nil {
		h.errorResponse(c, http.StatusServiceUnavailable, "api_error", "图片价格暂时无法查询，请稍后重试")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"model": "gpt-image-2", "currency": "USD", "unit": "image",
		"prices": prices, "observed_at": time.Now().UTC(), "billing_size_source": "output",
	})
}
