from rest_framework import serializers


class PlaceBetSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=32, required=False)
    type = serializers.CharField(max_length=16, required=False)
    value = serializers.CharField(max_length=8, required=False, allow_blank=True, default="")
    amount = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        key = attrs.get("key")
        bet_type = attrs.get("type")
        if key:
            return attrs
        if not bet_type:
            raise serializers.ValidationError("provide key or type")
        value = attrs.get("value") or ""
        attrs["key"] = f"{bet_type}:{value}" if value else bet_type
        return attrs


class SpinSerializer(serializers.Serializer):
    # Optional for tests / demos; ignored in production if you remove it later.
    number = serializers.IntegerField(required=False, min_value=0, max_value=36)
