import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useLanguage } from "@/context/LanguageContext";

export default function NotFoundScreen() {
  const { t } = useLanguage();
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>{t("notFound.title")}</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>{t("notFound.goHome")}</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  title: { fontSize: 20, fontWeight: "bold" },
  link: { marginTop: 15, paddingVertical: 15 },
  linkText: { fontSize: 14, color: "#2e78b7" },
});
