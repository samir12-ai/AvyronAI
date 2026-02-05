import React, { useState, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { CalendarDay } from '@/components/CalendarDay';
import { ContentCard } from '@/components/ContentCard';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { contentItems, removeContentItem } = useApp();

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(today.getDate());
  const [currentMonth] = useState(today.getMonth());
  const [currentYear] = useState(today.getFullYear());

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push({ date: 0, key: `empty-${i}` });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: i, key: `day-${i}` });
    }
    return days;
  }, [firstDayOfMonth, daysInMonth]);

  const scheduledDates = useMemo(() => {
    const dates = new Set<number>();
    contentItems.forEach(item => {
      if (item.scheduledDate) {
        const date = new Date(item.scheduledDate);
        if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
          dates.add(date.getDate());
        }
      }
    });
    return dates;
  }, [contentItems, currentMonth, currentYear]);

  const selectedContent = useMemo(() => {
    return contentItems.filter(item => {
      if (item.scheduledDate) {
        const date = new Date(item.scheduledDate);
        return date.getDate() === selectedDate && 
               date.getMonth() === currentMonth && 
               date.getFullYear() === currentYear;
      }
      return false;
    });
  }, [contentItems, selectedDate, currentMonth, currentYear]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>Content Calendar</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Schedule and manage your content
        </Text>

        <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.monthHeader}>
            <Text style={[styles.monthTitle, { color: colors.text }]}>
              {MONTHS[currentMonth]} {currentYear}
            </Text>
          </View>

          <View style={styles.weekDays}>
            {DAYS.map(day => (
              <Text key={day} style={[styles.weekDay, { color: colors.textMuted }]}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.daysGrid}>
            {calendarDays.map(item => (
              item.date === 0 ? (
                <View key={item.key} style={styles.emptyDay} />
              ) : (
                <CalendarDay
                  key={item.key}
                  date={item.date}
                  isToday={item.date === today.getDate() && currentMonth === today.getMonth()}
                  isSelected={item.date === selectedDate}
                  hasContent={scheduledDates.has(item.date)}
                  onPress={() => setSelectedDate(item.date)}
                />
              )
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {selectedDate === today.getDate() ? 'Today' : `${MONTHS[currentMonth]} ${selectedDate}`}
          </Text>
          
          {selectedContent.length > 0 ? (
            <View style={styles.contentList}>
              {selectedContent.map(item => (
                <ContentCard
                  key={item.id}
                  item={item}
                  onPress={() => {}}
                  onDelete={() => removeContentItem(item.id)}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="calendar-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No content scheduled</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                Create content and schedule it for this day
              </Text>
            </View>
          )}
        </View>

        {contentItems.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>All Content</Text>
            <View style={styles.contentList}>
              {contentItems.map(item => (
                <ContentCard
                  key={item.id}
                  item={item}
                  onPress={() => {}}
                  onDelete={() => removeContentItem(item.id)}
                />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 24,
  },
  calendarCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  monthHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  weekDays: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  weekDay: {
    width: 40,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  emptyDay: {
    width: 40,
    height: 44,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  contentList: {
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
